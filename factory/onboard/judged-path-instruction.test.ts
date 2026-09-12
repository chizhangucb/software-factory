/**
 * The instruction every target's other producers read (#181): the line in
 * `templates/agents-md-judged-path.md` that tells anything but the factory opening a PR on a
 * target, an interactive session or a cloud agent, to do the three things ADR 0003's judged
 * path needs, or its PR sits blocked on `factory/verdict` for good. The subject is text a
 * target copies and pages a reader meets, so the files are the fixture, in the style of
 * `lib/labels.test.ts` over the hold and `dispatch/triggers.test.ts` over the trigger set.
 * What `scripts/onboard.sh` prints of it is `onboard.test.ts`'s, beside the rest of its output.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

import { issuesClosedBy, linkedIssueNumber } from "../lib/linked-issue.ts";

/**
 * The agreed bytes, copied out of #181 programmatically rather than retyped, and the pin.
 * The template and every other copy are compared against this literal, never against each
 * other: a copy compared with another copy of itself agrees by construction and proves nothing.
 */
const JUDGED_PATH_INSTRUCTION =
  "- **Opening a pull request yourself**: your branch has to be in this repo, not a fork. Put `Closes #N` in the body, label it `agent:review`, and arm auto-merge. All three, or it stays blocked. The factory judges it and merges it.";
const JUDGED_PATH_TEMPLATE = "templates/agents-md-judged-path.md";

/** A file in this repo, by its path from the root. */
const readRepo = (file: string): string => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

/**
 * Where a copy of the instruction could live: the pages a maintainer or an agent reads, what
 * a target copies, and the code and prompts. Named roots rather than a walk from the top,
 * because a checkout of this repo holds other sessions' worktrees under `.claude/`. Test files
 * are left out, since the pin above lives in one.
 */
const INSTRUCTION_ROOTS = ["README.md", "CONTEXT.md", "AGENTS.md", "CLAUDE.md", "docs", "templates", "scripts", "factory", ".github"];
const nonTestFiles = (entry: string): string[] => {
  const url = new URL(`../../${entry}`, import.meta.url);
  if (!fs.existsSync(url)) return [];
  if (!fs.statSync(url).isDirectory()) return entry.endsWith(".test.ts") ? [] : [entry];
  return fs.readdirSync(url).flatMap((name) => (name === "node_modules" ? [] : nonTestFiles(`${entry}/${name}`)));
};

test("the template a target copies is the agreed instruction, byte for byte", () => {
  // One line and its newline, nothing else, so copying the whole file is copying the line.
  assert.equal(readRepo(JUDGED_PATH_TEMPLATE), `${JUDGED_PATH_INSTRUCTION}\n`);
});

test("every copy of the instruction in the tree is the agreed one, not a near miss", () => {
  // Anchored on the bullet's own name, so a copy reworded anywhere after it is still found,
  // and then held to the whole literal rather than to the anchor.
  const anchor = "Opening a pull request yourself";
  const carrying = INSTRUCTION_ROOTS.flatMap(nonTestFiles)
    .map((file) => ({ file, lines: readRepo(file).split("\n").filter((line) => line.includes(anchor)) }))
    .filter(({ lines }) => lines.length > 0);
  assert.ok(carrying.some(({ file }) => file === JUDGED_PATH_TEMPLATE), `${JUDGED_PATH_TEMPLATE} carries the instruction`);
  for (const { file, lines } of carrying) {
    for (const line of lines) {
      assert.ok(line.includes(JUDGED_PATH_INSTRUCTION), `${file} carries a copy of the instruction that has drifted: ${line}`);
    }
  }
});

test("the instruction's keyword is one the reviewer reads, and its placeholder claims no ticket", () => {
  // Read by the same regex the dispatcher, the reviewer and the merge gate share. `#N` is not a
  // number, so the line can sit in an AGENTS.md or be quoted in a PR body without the dispatcher
  // skipping any ticket over it; with a real number in place it is the PR's ticket, which is the
  // whole of what the instruction asks the keyword to do.
  assert.deepEqual(issuesClosedBy(JUDGED_PATH_INSTRUCTION), []);
  assert.equal(linkedIssueNumber(JUDGED_PATH_INSTRUCTION.replace("#N", "#42")), "42");
});

test("README's onboarding names the instruction in the step that names the caller and the routing test command", () => {
  // The step where a maintainer copies files into the target is where one more thing to copy
  // gets seen. Read as that one step, not the whole page, so naming it anywhere else fails.
  const onboarding = readRepo("README.md")
    .split(/^## /m)
    .find((section) => section.startsWith("Onboard a target repo"));
  assert.ok(onboarding, "README still has its onboarding section");
  // Found by the routing test command, which only the copying step names; the caller turns up
  // in a later step too, where its permissions are checked.
  const copying = onboarding.split(/^(?=\d+\. )/m).filter((step) => step.includes("templates/routing-test-command.sh"));
  assert.equal(copying.length, 1, "one step names the routing test command");
  assert.ok(copying[0]!.includes("templates/factory.yml"), "and it is the step that names the caller");
  assert.ok(copying[0]!.includes(JUDGED_PATH_TEMPLATE), `the same step names ${JUDGED_PATH_TEMPLATE}`);
  // The prose is a paraphrase, not a copy, so the literal above does not hold it and it would
  // otherwise drift uncaught. It names the fork precondition beside the three steps, or a
  // maintainer reading only the README under-describes the line they are about to copy.
  assert.match(copying[0]!, /fork/, "and its prose names the fork precondition");
});

test("CONTEXT.md defines the producer the instruction addresses", () => {
  // The Judged path entry uses the word and nothing defined it, while a producer is the whole
  // audience of the line a target copies. Glossary shape only: the entry exists once, and says
  // it is anyone but the factory opening a PR on the target.
  // An entry is its bold term and the definition on the line under it, the glossary's shape.
  const lines = readRepo("CONTEXT.md").split("\n");
  const terms = lines.filter((line) => line.startsWith("**Producer**:"));
  assert.equal(terms.length, 1, "Producer is defined, once");
  const definition = lines[lines.indexOf(terms[0]!) + 1] ?? "";
  assert.match(definition, /other than the factory/, "and says it is anyone but the factory");
});

test("the Close convention is still one bullet of docs/agents/issue-tracker.md", () => {
  // Structure only (#220): the rule this bullet carries is proven functionally in
  // dispatch/select.test.ts and lib/linked-issue.test.ts, so wording here is the next
  // person's to shorten. This only catches the bullet splitting or disappearing.
  const close = readRepo("docs/agents/issue-tracker.md")
    .split("\n")
    .filter((line) => line.startsWith("- **Close**"));
  assert.equal(close.length, 1, "the Close convention is still one bullet");
});

test("ADR 0003's bullet on the tracker page's ban carries its dated correction, since the ban is gone", () => {
  // The bullet says the page forbids the keyword outright, which was true when it was written.
  // ADRs are amended in place and dated rather than rewritten, so the sentence stays and the
  // correction beside it is what stops the ADR contradicting the page it describes.
  const bullet = readRepo("docs/adr/0003-gate-in-ci-auto-merge-with-audit.md")
    .split("\n")
    .filter((line) => line.startsWith("- **The convention against closing keywords narrows.**"));
  assert.equal(bullet.length, 1, "the bullet is still there, once");
  assert.match(bullet[0]!, /Corrected 2026-09-11 \(#181\): /, "and says the outright ban has lapsed");
});

test("ADR 0003's judged-path paragraph carries its dated correction, since the factory is not a producer", () => {
  // The heading reads as if the factory were one producer among them, the one phrase in the file
  // out of step with the glossary. ADRs are amended in place and dated rather than rewritten, so
  // the sentence stays and the correction beside it is what stops the second reading.
  const paragraph = readRepo("docs/adr/0003-gate-in-ci-auto-merge-with-audit.md")
    .split("\n")
    .filter((line) => line.startsWith("**What a producer other than the factory does.**"));
  assert.equal(paragraph.length, 1, "the paragraph is still there, once, its sentence preserved");
  assert.match(paragraph[0]!, /Corrected 2026-09-11 \(#233\): /, "and says the factory is not a producer");
});

test("no page reads the factory as a producer except the ADR line that carries the correction", () => {
  // "a producer other than the factory" is the one phrasing that only parses if the factory is
  // one, so a second copy of it anywhere is a second reading of the word. Test files are left
  // out, since the pin above quotes the phrase.
  const carrying = INSTRUCTION_ROOTS.flatMap(nonTestFiles)
    .flatMap((file) => readRepo(file).split("\n").map((line) => ({ file, line })))
    .filter(({ line }) => /producers? other than the factory/.test(line));
  for (const { file, line } of carrying) {
    assert.ok(line.includes("Corrected 2026-09-11 (#233): "), `${file} reads the factory as a producer: ${line}`);
  }
});
