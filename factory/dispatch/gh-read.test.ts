import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import {
  MAX_PAGES,
  PER_PAGE,
  PROJECTIONS,
  type Page,
  describeGhFailure,
  nextPage,
  pageUrl,
} from "./gh-read.ts";
import { marksFromTimeline, roleFromJobs, runFromGitHub, stateSinceFromTimeline, ticketFromGitHub } from "./reconcile.ts";

const pagesDir = path.join(import.meta.dirname, "fixtures", "pages");
const page = (name: string): string => fs.readFileSync(path.join(pagesDir, `${name}.json`), "utf8");

/** What `gh api --jq <projection>` prints for a page: the same jq program over the same JSON. */
const project = (projection: keyof typeof PROJECTIONS, name: string): any[] =>
  JSON.parse(execFileSync("jq", [PROJECTIONS[projection]], { input: page(name), encoding: "utf8" }));

test("runs projection keeps what runFromGitHub reads and drops the rest of the payload", () => {
  const runs = project("runs", "runs");
  assert.deepEqual(Object.keys(runs[0]).sort(), ["conclusion", "created_at", "display_title", "event", "head_branch", "id", "status", "updated_at"]);
  assert.equal(runs.length, 2);
  assert.equal(runFromGitHub(runs[0]).id, 34158412274);
  assert.equal(runFromGitHub(runs[0]).event, "pull_request");
  assert.equal(runFromGitHub(runs[0]).headBranch, "feat/19-proof-run");
  assert.equal(runFromGitHub(runs[0]).status, "completed");
  assert.ok(JSON.stringify(runs).length < 1000, "a projected run page is a few hundred bytes, not tens of KB");
});

test("issues projection keeps number, title, labels, and whether the issue is a PR", () => {
  const issues = project("issues", "issues");
  assert.deepEqual(issues.map((i: any) => [i.number, Boolean(i.pull_request)]), [[35, false], [41, true]]);
  const ticket = ticketFromGitHub(issues[0]);
  assert.equal(ticket.title, "Reconciler: repair stuck factory states on every sweep");
  assert.deepEqual(ticket.labels, ["ready-for-agent"]);
  assert.deepEqual(ticketFromGitHub(issues[1]).labels, ["agent:review"]);
});

test("timeline projection keeps label events and the sweep mark at the head of a comment", () => {
  const events = project("timeline", "timeline");
  assert.equal(stateSinceFromTimeline(events, "agent:implement"), "2026-09-07T19:20:00Z");
  assert.equal(stateSinceFromTimeline(events, "ready-for-agent"), "2026-09-07T17:58:28Z");
  assert.deepEqual(marksFromTimeline(events), [{ miss: 1, at: "2026-09-07T19:10:00Z" }]);
  for (const e of events) assert.ok((e.body ?? "").length <= 64, "comment bodies are cut to the mark's width");
});

test("jobs projection feeds roleFromJobs", () => {
  assert.equal(roleFromJobs(project("jobs", "jobs")), "implement");
});

test("statuses projection keeps context and state only", () => {
  assert.deepEqual(project("statuses", "status"), [
    { context: "factory/verdict", state: "success" },
    { context: "factory/red-green", state: "pending" },
  ]);
});

test("a full page asks for the next one, a short page ends the walk", () => {
  const full: Page = { page: 1, received: PER_PAGE };
  assert.deepEqual(nextPage(full), { next: 2 });
  assert.deepEqual(nextPage({ page: 3, received: PER_PAGE - 1 }), { done: "short page" });
  assert.deepEqual(nextPage({ page: 1, received: 0 }), { done: "short page" });
});

test("the walk stops at the page cap even when pages keep coming full", () => {
  assert.deepEqual(nextPage({ page: MAX_PAGES - 1, received: PER_PAGE }), { next: MAX_PAGES });
  assert.deepEqual(nextPage({ page: MAX_PAGES, received: PER_PAGE }), { done: "page cap" });
});

test("pageUrl appends per_page and page to a path with or without a query", () => {
  assert.equal(pageUrl("repos/o/r/issues?state=open", 2), `repos/o/r/issues?state=open&per_page=${PER_PAGE}&page=2`);
  assert.equal(pageUrl("repos/o/r/issues/7/timeline", 1), `repos/o/r/issues/7/timeline?per_page=${PER_PAGE}&page=1`);
});

test("a gh failure is described by its command and cause, never a stack", () => {
  const enobufs = Object.assign(new Error("spawnSync gh ENOBUFS"), { code: "ENOBUFS", stdout: "x".repeat(2000), stderr: "" });
  assert.equal(describeGhFailure(["api", "repos/o/r/actions/runs"], enobufs), "gh api repos/o/r/actions/runs failed: ENOBUFS (spawnSync gh ENOBUFS)");

  const http = Object.assign(new Error("Command failed: gh api ..."), { status: 1, stderr: "gh: Not Found (HTTP 404)\n" });
  assert.equal(describeGhFailure(["api", "repos/o/r/nope"], http), "gh api repos/o/r/nope failed: exit 1, gh: Not Found (HTTP 404)");

  assert.equal(describeGhFailure(["pr", "list"], "boom"), "gh pr list failed: boom");
});
