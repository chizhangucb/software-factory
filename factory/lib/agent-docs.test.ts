/**
 * The `docs/agents/` pages are the repo's own (#215), so each rule sits on the page it
 * belongs to. The files are the fixture, in the style of `onboard/judged-path-instruction.test.ts`.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

const repoUrl = (file: string): URL => new URL(`../../${file}`, import.meta.url);
const readRepo = (file: string): string => fs.readFileSync(repoUrl(file), "utf8");

/** Named roots rather than a walk from the top: `.claude/` holds other sessions' worktrees. */
const ROOTS = ["README.md", "CONTEXT.md", "AGENTS.md", "docs", "templates", "scripts", "factory", ".github"];
const filesUnder = (entry: string): string[] => {
  if (!fs.existsSync(repoUrl(entry))) return [];
  if (!fs.statSync(repoUrl(entry)).isDirectory()) return [entry];
  return fs.readdirSync(repoUrl(entry)).flatMap((name) => (name === "node_modules" ? [] : filesUnder(`${entry}/${name}`)));
};

const REMOVED = ["docs/agents/hold.md", "docs/agents/tracker-conventions.md", "factory/lib/vendored-agent-docs.test.ts"];

test("the removed pages and test are gone, and no file names them", () => {
  for (const file of REMOVED) assert.ok(!fs.existsSync(repoUrl(file)), `${file} is gone`);
  const names = REMOVED.map((file) => file.split("/").at(-1)!);
  for (const file of ROOTS.flatMap(filesUnder).filter((file) => file !== "factory/lib/agent-docs.test.ts")) {
    const text = readRepo(file);
    for (const name of names) assert.ok(!text.includes(name), `${file} names ${name}`);
  }
});

test("hold is one row of triage-labels.md, and the page names it nowhere else", () => {
  const hold = readRepo("docs/agents/triage-labels.md").split("\n").filter((line) => line.includes("`hold`"));
  assert.equal(hold.length, 1, "the page names hold on one line");
  assert.match(hold[0]!, /^\| .* \|$/, "and that line is a row of the table");
  assert.match(hold[0]!, /never dispatched, retried or requeued/);
  assert.match(hold[0]!, /does not stop an open PR: close the PR/);
});

test("issue-tracker.md carries the repo's tracker rules: when a ticket closes, and what its body says it removes", () => {
  const page = readRepo("docs/agents/issue-tracker.md");
  assert.match(page, /the moment its PR merges/, "a ticket closes the moment its PR merges");
  assert.match(page, /`blocked_by` clears only on close/, "which is what unblocks what it blocks");
  assert.match(page, /removes something says so in its body/, "a ticket names what it removes");
  assert.match(page, /every deleted test/, "since every deleted test is judged against it");
});

test("factory/plugins/README.md leaves docs/agents alone: no verbatim claim, no re-copy step", () => {
  assert.doesNotMatch(readRepo("factory/plugins/README.md"), /docs\/agents/);
});
