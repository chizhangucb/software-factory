/**
 * The instruction every target's other producers read (#181): the line in
 * `templates/agents-md-judged-path.md` that tells anything but the factory opening a PR on a
 * target, an interactive session or a cloud agent, to do the three things ADR 0007's judged
 * path needs, or its PR sits blocked on `factory/verdict` for good. The subject is text a
 * target copies and pages a reader meets, so the files are the fixture, in the style of
 * `lib/labels.test.ts` over the hold and `dispatch/triggers.test.ts` over the trigger set.
 * What `scripts/onboard.sh` prints of it is `onboard.test.ts`'s, beside the rest of its output.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

import { issuesClosedBy, linkedIssueNumber } from "../lib/linked-issue.ts";
import { repoFiles } from "../lib/repo-files.ts";

/**
 * The agreed bytes, copied out of #181 programmatically rather than retyped, and the pin.
 * The template and every other copy are compared against this literal, never against each
 * other: a copy compared with another copy of itself agrees by construction and proves nothing.
 */
const JUDGED_PATH_INSTRUCTION =
  "- **Opening a pull request yourself**: your branch has to be in this repo, not a fork. Put `Closes #N` in the body, label it `agent:review`, and arm auto-merge. All three, or it stays blocked. The factory judges it and merges it.";
const JUDGED_PATH_TEMPLATE = "templates/agents-md-judged-path.md";
/** The decision the instruction comes from. */
const JUDGED_PATH_ADR = "docs/adr/0007-no-unjudged-merge-path.md";

/** A file in this repo, by its path from the root. */
const readRepo = (file: string): string => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("the template a target copies is the agreed instruction, byte for byte", () => {
  // One line and its newline, nothing else, so copying the whole file is copying the line.
  assert.equal(readRepo(JUDGED_PATH_TEMPLATE), `${JUDGED_PATH_INSTRUCTION}\n`);
});

test("every copy of the instruction in the tree is the agreed one, not a near miss", () => {
  // Anchored on the bullet's own name, so a copy reworded anywhere after it is still found,
  // and then held to the whole literal rather than to the anchor.
  const anchor = "Opening a pull request yourself";
  const carrying = repoFiles()
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

test("README's onboarding names both templates and the fork precondition", () => {
  // A maintainer following onboarding has to discover the caller and the two conditional extras,
  // or they copy an incomplete set. Read as the whole onboarding section, since the extras are a
  // note beside the numbered steps rather than crammed into one of them.
  const onboarding = readRepo("README.md")
    .split(/^## /m)
    .find((section) => section.startsWith("Onboard a target repo"));
  assert.ok(onboarding, "README still has its onboarding section");
  assert.ok(onboarding.includes("templates/factory.yml"), "onboarding names the caller");
  assert.ok(onboarding.includes("templates/routing-test-command.sh"), "onboarding names the routing test command");
  assert.ok(onboarding.includes(JUDGED_PATH_TEMPLATE), `onboarding names ${JUDGED_PATH_TEMPLATE}`);
  // The prose is a paraphrase, not a copy, so the literal instruction does not hold it. It names
  // the fork precondition, or a maintainer reading only the README under-describes the line.
  assert.match(onboarding, /fork/, "and names the fork precondition");
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

test("no page reads the factory as a producer", () => {
  // The glossary defines a producer as anyone but the factory opening a PR, so "a producer other
  // than the factory" is a phrasing that only parses if the factory is one of them. It appears
  // nowhere in the tree. This file is left out, since the line above quotes the phrase itself.
  const thisFile = "factory/onboard/judged-path-instruction.test.ts";
  const carrying = repoFiles()
    .filter((file) => file !== thisFile)
    .flatMap((file) => readRepo(file).split("\n").map((line) => ({ file, line })))
    .filter(({ line }) => /producers? other than the factory/.test(line));
  assert.deepEqual(carrying, [], "no page reads the factory as a producer");
});
