import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import { PROJECTIONS, STATUSES_PROJECTION, describeGhFailure, parseItems } from "./gh-read.ts";
import { marksFromTimeline, roleFromJobs, runFromGitHub, stateSinceFromTimeline, ticketFromGitHub } from "./reconcile.ts";

const pagesDir = path.join(import.meta.dirname, "fixtures", "pages");
const page = (name: string): string => fs.readFileSync(path.join(pagesDir, `${name}.json`), "utf8");

/**
 * What `gh api --jq <program>` prints for a page: the same jq program over
 * the same JSON, compact, one value per line. The projections are jq, so the
 * one honest test runs jq; this is the only test in the repo that spawns a
 * process (still no network). The ubuntu runner and macOS ship jq.
 */
const jq = (program: string, name: string): string => {
  try {
    return execFileSync("jq", ["-c", program], { input: page(name), encoding: "utf8" });
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") assert.fail("jq is not installed; these tests run the projections through jq");
    throw error;
  }
};
/** The sweep's read path: gh's line output back into items. */
const project = (projection: keyof typeof PROJECTIONS, name: string): any[] => parseItems(jq(PROJECTIONS[projection], name));

test("runs projection keeps the eight fields runFromGitHub reads and drops the rest of the payload", () => {
  const runs = project("runs", "runs");
  assert.equal(runs.length, 2);
  assert.deepEqual(Object.keys(runs[0]).sort(), ["conclusion", "created_at", "display_title", "event", "head_branch", "id", "status", "updated_at"]);
  assert.equal(runFromGitHub(runs[0]).id, 34158412274);
  assert.ok(JSON.stringify(runs).length * 10 < page("runs").length, "a projected run is under a tenth of the raw one");
});

test("issues projection keeps number, title, labels, and whether the issue is a PR", () => {
  const issues = project("issues", "issues");
  assert.deepEqual(issues.map((i: any) => [i.number, Boolean(i.pull_request)]), [[35, false], [41, true]]);
  assert.deepEqual(issues.map((i: any) => ticketFromGitHub(i).labels), [["ready-for-agent"], ["agent:review"]]);
});

test("timeline projection keeps label events and the sweep mark at the head of a comment", () => {
  const events = project("timeline", "timeline");
  assert.equal(stateSinceFromTimeline(events, "agent:implement"), "2026-09-07T19:20:00Z");
  assert.deepEqual(marksFromTimeline(events), [{ miss: 1, at: "2026-09-07T19:10:00Z" }]);
  for (const e of events) assert.ok((e.body ?? "").length <= 64, "comment bodies are cut to the mark's width");
});

test("jobs projection feeds roleFromJobs", () => {
  assert.equal(roleFromJobs(project("jobs", "jobs")), "implement");
});

test("statuses projection keeps context and state only", () => {
  assert.deepEqual(JSON.parse(jq(STATUSES_PROJECTION, "status")), [
    { context: "factory/verdict", state: "success" },
    { context: "factory/red-green", state: "pending" },
  ]);
});

test("parseItems reads one item per line, tolerates blank lines, and is empty for no output", () => {
  assert.deepEqual(parseItems('{"id":1}\n{"id":2}\n'), [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(parseItems(""), []);
  assert.deepEqual(parseItems("\n"), []);
});

test("parseItems names the line that is not JSON", () => {
  assert.throws(() => parseItems('{"id":1}\ngh: oops\n'), /line 2 is not JSON: gh: oops/);
});

test("a gh failure is described by its command and cause, never a stack", () => {
  const enobufs = Object.assign(new Error("spawnSync gh ENOBUFS"), { code: "ENOBUFS", stdout: "x".repeat(2000), stderr: "" });
  assert.equal(describeGhFailure(["api", "repos/o/r/actions/runs"], enobufs), "gh api repos/o/r/actions/runs failed: ENOBUFS (spawnSync gh ENOBUFS)");

  const http = Object.assign(new Error("Command failed: gh api ..."), { status: 1, stderr: "gh: Not Found (HTTP 404)\n" });
  assert.equal(describeGhFailure(["api", "repos/o/r/nope"], http), "gh api repos/o/r/nope failed: exit 1, gh: Not Found (HTTP 404)");

  const killed = Object.assign(new Error("Command failed: gh api x"), { status: null, signal: "SIGTERM", stderr: "" });
  assert.equal(describeGhFailure(["api", "x"], killed), "gh api x failed: killed by SIGTERM");

  assert.equal(describeGhFailure(["pr", "list"], "boom"), "gh pr list failed: boom");
});
