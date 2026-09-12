/**
 * The `docs/agents/` pages are the repo's own (#215), so each rule sits on the page it
 * belongs to. The files are the fixture, in the style of `onboard/judged-path-instruction.test.ts`.
 * Structure only (#218): a page's wording is the next person's to shorten, so no assertion here
 * quotes a sentence of one.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

import { allRepoFiles } from "./repo-files.ts";

const repoUrl = (file: string): URL => new URL(`../../${file}`, import.meta.url);
const readRepo = (file: string): string => fs.readFileSync(repoUrl(file), "utf8");
const linesOf = (file: string): string[] => readRepo(file).split("\n");

const REMOVED = ["docs/agents/hold.md", "docs/agents/tracker-conventions.md", "factory/lib/vendored-agent-docs.test.ts"];

test("the removed pages and test are gone, and no file names them", () => {
  for (const file of REMOVED) assert.ok(!fs.existsSync(repoUrl(file)), `${file} is gone`);
  // A whole name only, so `threshold.md` is not `hold.md`.
  const names = REMOVED.map((file) => new RegExp(`(?<![\\w.-])${file.split("/").at(-1)!.replaceAll(".", "\\.")}`));
  for (const file of allRepoFiles().filter((file) => file !== "factory/lib/agent-docs.test.ts")) {
    const text = readRepo(file);
    for (const name of names) assert.doesNotMatch(text, name, `${file} names a removed file`);
  }
});

/** The pages AGENTS.md points at, since a pointer to a page that is gone or gutted routes nobody. */
test("every docs/agents page AGENTS.md names carries a body under its title", () => {
  const pages = new Set([...readRepo("AGENTS.md").matchAll(/docs\/agents\/[\w-]+\.md/g)].map((hit) => hit[0]));
  assert.ok(pages.size > 0, "AGENTS.md points at the pages");
  for (const page of pages) {
    assert.ok(fs.existsSync(repoUrl(page)), `${page} is there for AGENTS.md to point at`);
    const body = linesOf(page).filter((line) => line.trim() !== "");
    assert.match(body[0] ?? "", /^# /, `${page} opens on a title`);
    assert.ok(body.length > 1, `${page} carries rules under its title`);
  }
});

test("hold is one row of triage-labels.md, and the page names it nowhere else", () => {
  const hold = linesOf("docs/agents/triage-labels.md").filter((line) => line.includes("`hold`"));
  assert.equal(hold.length, 1, "the page names hold on one line");
  assert.match(hold[0]!, /^\| .* \|$/, "and that line is a row of the table");
});

test("factory/plugins/README.md leaves docs/agents alone: no verbatim claim, no re-copy step", () => {
  assert.doesNotMatch(readRepo("factory/plugins/README.md"), /docs\/agents/);
});
