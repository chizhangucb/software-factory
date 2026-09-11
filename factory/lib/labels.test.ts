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
 *
 * The last test is the other half of the same subject and the reason this file
 * is not only about prose: which strings the dispatcher is allowed to decide
 * on at all (ADR 0005).
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

import { DISPATCH_LABEL, FACTORY_STATE_LABELS } from "../dispatch/select.ts";
import { ESCALATION_LABEL, HANDED_OFF_LABELS, HOLD_LABEL, HOLD_LABELS, READY_LABEL } from "./labels.ts";

/**
 * The pages that have to name the hold set. Every other page in `docs/` is
 * checked too, if it names the set at all: the list below is the floor, not
 * the whole guard, so a new page that names the set wrongly fails here rather
 * than waiting for someone to add it to a list.
 */
const HOLD_SET_SITES = ["docs/adr/0005-four-labels-that-end-in-a-human.md", "docs/pipeline.md", "docs/agents/hold.md"];

/**
 * The form a page names the set in: the words "hold set" then the labels in
 * backticks, in parentheses. A literal form rather than a loose scan, so the
 * test reads one sentence per page and cannot be satisfied by the labels
 * happening to appear near each other.
 */
const HOLD_SET = /hold set \(([^)]*)\)/g;

/**
 * The markdown a reader of this repo meets: everything under `docs/`, plus the
 * two pages at the root that also describe the hold. `README.md` is the front
 * door and `CONTEXT.md` is the glossary, so a set named wrongly in either is as
 * stale as one named wrongly in `docs/`, and scanning only `docs/` would leave
 * both outside the guard this test exists to be.
 */
const docPages = (dir = "docs"): string[] => [
  ...(dir === "docs" ? ["README.md", "CONTEXT.md"] : []),
  ...fs.readdirSync(new URL(`../../${dir}`, import.meta.url), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? docPages(`${dir}/${entry.name}`) : entry.name.endsWith(".md") ? [`${dir}/${entry.name}`] : [],
  ),
];

/** The labels a page names as the hold set, once per occurrence, in the order written. */
const namedSets = (text: string): string[][] =>
  [...text.matchAll(HOLD_SET)].map((match) => match[1]!.split(",").map((label) => label.trim().replace(/`/g, "")));

test("every doc page that names the hold set names the set the dispatcher enforces", () => {
  const pages = docPages();
  for (const site of HOLD_SET_SITES) {
    assert.ok(pages.includes(site), `${site} is still a page, and still the one a reader is sent to`);
  }
  // One read per page: the same text answers both which pages name the set and
  // which labels each of them names.
  const named = new Map(pages.map((page) => [page, namedSets(fs.readFileSync(new URL(`../../${page}`, import.meta.url), "utf8"))]));
  const naming = pages.filter((page) => named.get(page)!.length > 0);
  assert.deepEqual(
    naming.sort(),
    [...HOLD_SET_SITES].sort(),
    "the pages naming the hold set are the ones meant to, and no others",
  );
  for (const site of naming) {
    const sets = named.get(site)!;
    assert.equal(sets.length, 1, `${site} names the hold set exactly once`);
    // In order, not as a set: `hold` leads because it is the one to reach for,
    // and the other two follow as the backstop they are.
    assert.deepEqual(sets[0], [...HOLD_LABELS], `${site} names the hold set the dispatcher enforces`);
  }
});

test("the hold label is unprefixed, so it reads as a human's instruction rather than factory state", () => {
  // `agent:` means factory state in this vocabulary (`isAgentLabel`), and a
  // hold is a human talking to the factory, not the factory reporting on
  // itself. Being unprefixed is also what makes it collidable: `hold` is an
  // ordinary English word a target may already use for its own meaning, and
  // `onboard.sh` creates labels with `--force`, so onboarding rewrites such a
  // label in place and turns every issue already carrying it into a dispatch
  // veto. `docs/pipeline.md` says to check for that before onboarding.
  assert.equal(HOLD_LABEL, "hold");
  assert.equal(HOLD_LABELS[0], HOLD_LABEL, "the label to reach for leads the set");
  assert.ok(!HOLD_LABELS.some((label) => label.startsWith("agent:")));
});

/**
 * The nine labels GitHub creates on every new repository, whether anyone asks
 * for them or not. A target carries all nine before `scripts/onboard.sh`
 * writes one label of the factory's own.
 */
const GITHUB_DEFAULT_LABELS = [
  "bug",
  "documentation",
  "duplicate",
  "enhancement",
  "good first issue",
  "help wanted",
  "invalid",
  "question",
  "wontfix",
];

test("every label the dispatcher decides on is one this repo defines, never one GitHub ships", () => {
  // ADR 0005 is the reasoning; this is the part of it a test can hold. A
  // default in any of these lists would give a meaning GitHub publishes and
  // this repo does not control a private effect on a target's queue, so the
  // people using that label as it reads would be stopping the factory without
  // knowing. `wontfix` is how close it already runs: a GitHub default and one
  // of the five triage roles in `docs/agents/triage-labels.md`, which the
  // dispatcher happens not to read.
  // Both homes of the factory state strings, not just one: `dispatch/select.ts`
  // still keeps its own `DISPATCH_LABEL` and `FACTORY_STATE_LABELS` while
  // `lib/labels.ts` is where they land (#122), and update-branch and the retry
  // handler read `HANDED_OFF_LABELS` and `ESCALATION_LABEL` rather than either
  // of those. Naming all of them means the guard holds whichever list a new
  // label is added to, and survives the repointing that deletes the duplicates.
  const read = [
    READY_LABEL,
    ...HOLD_LABELS,
    ...HANDED_OFF_LABELS,
    ESCALATION_LABEL,
    DISPATCH_LABEL,
    ...FACTORY_STATE_LABELS,
  ];
  // Case-insensitively: GitHub's label names are unique without regard to case,
  // so `Bug` is not a second label beside the default `bug`, it is that label
  // reached by a different spelling, and `onboard.sh --force` would rewrite the
  // default in place exactly as the lowercase spelling would.
  const defaults = new Set(GITHUB_DEFAULT_LABELS.map((label) => label.toLowerCase()));
  for (const label of read) {
    assert.ok(
      !defaults.has(label.toLowerCase()),
      `${label} is one of GitHub's default labels, so a target carries it whether or not anyone means it as an instruction`,
    );
  }
});
