/**
 * The hold set as a reader of the docs meets it. The subject is prose, so the
 * docs are the fixture, in the style of `dispatch/triggers.test.ts`'s test over
 * the trigger set: a page that names the set names the one the code enforces,
 * or this fails.
 *
 * Prose is where the drift that #169 is about actually happens. A held ticket
 * is held by a label a human reads about somewhere other than in the code, and
 * a page that lists two of the three tells that human the third is safe to
 * clear. Nothing else in the tree can see a doc going stale, so this does.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

import { HOLD_LABEL, HOLD_LABELS } from "./labels.ts";

/**
 * The pages that have to name the hold set. Every other page in `docs/` is
 * checked too, if it names the set at all: the list below is the floor, not
 * the whole guard, so a new page that names the set wrongly fails here rather
 * than waiting for someone to add it to a list.
 */
const HOLD_SET_SITES = ["docs/pipeline.md", "docs/agents/triage-labels.md"];

/**
 * The form a page names the set in: the words "hold set" then the labels in
 * backticks, in parentheses. A literal form rather than a loose scan, so the
 * test reads one sentence per page and cannot be satisfied by the labels
 * happening to appear near each other.
 */
const HOLD_SET = /hold set \(([^)]*)\)/g;

/** Every markdown file under `docs/`, repo-relative. */
const docPages = (dir = "docs"): string[] =>
  fs.readdirSync(new URL(`../../${dir}`, import.meta.url), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? docPages(`${dir}/${entry.name}`) : entry.name.endsWith(".md") ? [`${dir}/${entry.name}`] : [],
  );

/** The labels a page names as the hold set, once per occurrence, in the order written. */
const namedSets = (text: string): string[][] =>
  [...text.matchAll(HOLD_SET)].map((match) => match[1]!.split(",").map((label) => label.trim().replace(/`/g, "")));

test("every doc page that names the hold set names the set the dispatcher enforces", () => {
  const pages = docPages();
  for (const site of HOLD_SET_SITES) {
    assert.ok(pages.includes(site), `${site} is still a page, and still the one a reader is sent to`);
  }
  const naming = pages.filter((page) => namedSets(fs.readFileSync(new URL(`../../${page}`, import.meta.url), "utf8")).length > 0);
  assert.deepEqual(
    naming.sort(),
    [...HOLD_SET_SITES].sort(),
    "the pages naming the hold set are the ones meant to, and no others",
  );
  for (const site of naming) {
    const named = namedSets(fs.readFileSync(new URL(`../../${site}`, import.meta.url), "utf8"));
    assert.equal(named.length, 1, `${site} names the hold set exactly once`);
    // In order, not as a set: `hold` leads because it is the one to reach for,
    // and the other two follow as the backstop they are.
    assert.deepEqual(named[0], [...HOLD_LABELS], `${site} names the hold set the dispatcher enforces`);
  }
});

test("the hold label is unprefixed, so it reads as a human's instruction rather than factory state", () => {
  // `agent:` means factory state in this vocabulary (`isAgentLabel`), and a
  // hold is a human talking to the factory, not the factory reporting on
  // itself. It is also not one of GitHub's default labels, so it cannot
  // collide with a repo already using `hold` in its ordinary sense.
  assert.equal(HOLD_LABEL, "hold");
  assert.equal(HOLD_LABELS[0], HOLD_LABEL, "the label to reach for leads the set");
  assert.ok(!HOLD_LABELS.some((label) => label.startsWith("agent:")));
});
