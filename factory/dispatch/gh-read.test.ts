import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import { PROJECTIONS, STATUSES_PROJECTION, parseItems } from "./gh-read.ts";
import { trustPolicy } from "../lib/trusted-authors.ts";
import { commentFromGitHub, marksFromTimeline, roleFromJobs, runFromGitHub, stateSinceFromTimeline, ticketFromGitHub, toldNoTicketIn } from "./reconcile.ts";

const pagesDir = path.join(import.meta.dirname, "fixtures", "pages");
const page = (name: string): string => fs.readFileSync(path.join(pagesDir, `${name}.json`), "utf8");

/**
 * What `gh api --jq <program>` prints for a page: the same jq program over
 * the same JSON, compact, one value per line. The projections are jq, so the
 * one honest test runs jq. This test spawns a real process, as does
 * `factory/guards/require-worktree-isolation.test.ts`; still no network either
 * way. The ubuntu runner and macOS ship jq.
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
  assert.deepEqual(marksFromTimeline(events), [{ miss: 1, tries: 1, at: "2026-09-07T19:10:00Z" }]);
  for (const e of events) assert.ok((e.body ?? "").length <= 64, "comment bodies are cut to the mark's width");
});

test("comments projection carries the body's marker and who wrote it, so a forged marker is dropped (#230)", () => {
  const comments = project("comments", "comments").map(commentFromGitHub);
  assert.deepEqual(comments.map((c) => c.author.login), ["chizhangucb", "passer-by"]);
  assert.equal(toldNoTicketIn(comments, trustPolicy(undefined)), true);
  assert.equal(toldNoTicketIn(comments.slice(1), trustPolicy(undefined)), false);
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
