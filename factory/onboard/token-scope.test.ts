/**
 * Onboarding mints one token per target (#252). The subject is pages a maintainer reads, so the
 * files are the fixture, in the style of `judged-path-instruction.test.ts` beside it. The v0
 * decision that one `FACTORY_PAT` covers every target (#20) is amended rather than deleted, so
 * this pins the original sentence too: a correction that replaces what it corrects loses the
 * reasoning that was sound for the case it considered.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

import { repoFiles } from "../lib/repo-files.ts";

/** A file in this repo, by its path from the root. */
const readRepo = (file: string): string => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

/** The pages under test: the onboarding step a maintainer follows, and the decision behind it. */
const README = "README.md";
const PIPELINE = "docs/pipeline.md";

/**
 * The v0 decision as #20 left it, copied out of `docs/pipeline.md` rather than paraphrased.
 * Preserved verbatim: the amendment adds a trigger beside it, it does not rewrite it.
 */
const ORIGINAL_DECISION =
  "**One `FACTORY_PAT` covers every target in v0** (#20). Per-target tokens buy nothing while the same machine and the same workflows hold them all; split when a target is owned by someone else.";

/** The one line in the tree allowed to say a token covers every target, because it is that sentence. */
const decisionLine = (): string => {
  const lines = readRepo(PIPELINE).split("\n").filter((line) => line.includes(ORIGINAL_DECISION));
  assert.equal(lines.length, 1, `${PIPELINE} carries the #20 decision verbatim, exactly once`);
  return lines[0]!;
};

/** README's `FACTORY_PAT` bullet, the sentence a maintainer minting a token actually reads. */
const patBullet = (): string => {
  const lines = readRepo(README).split("\n").filter((line) => line.trim().startsWith("- `FACTORY_PAT`"));
  assert.equal(lines.length, 1, `${README} has one FACTORY_PAT bullet in the onboarding secrets step`);
  return lines[0]!;
};

test("the onboarding step scopes the token to the target being onboarded and nothing else", () => {
  const bullet = patBullet();
  // The fine-grained PAT form's own words for the control, so the bullet is followable as written.
  assert.match(bullet, /Only select repositories/);
  assert.match(bullet, /the target being onboarded/);
  assert.match(bullet, /nothing else/);
  // One per target, not one reused: the bullet has to say which of the two it means, and a reader
  // arriving with a token already in hand has to be told not to use it.
  assert.match(bullet, /one per target/i);
  assert.match(bullet, /reuse/i);
});

test("the pipeline note keeps the #20 sentence and carries a dated correction naming this ticket", () => {
  const line = decisionLine();
  // The repo's own correction form, as ADR 0003 uses it.
  assert.match(line, /Corrected 2026-09-11 \(#252\)/);
  // The second trigger, beside ownership rather than in place of it. The ticket's own name for it,
  // so the pin is on the agreed term and not on a phrasing chosen here.
  assert.ok(
    line.includes("owned by someone else"),
    "the correction leaves ownership standing as a trigger rather than replacing it",
  );
  assert.ok(line.includes("reach across visibility"), "and names reach across visibility as the second");
});

test("the correction says why per-target rather than a split by visibility tier", () => {
  const line = decisionLine();
  // A tier is the cheaper-looking answer, so the correction owes the reader both halves of why it
  // is not the answer: a tier token reaches the whole tier, and a repo can move between tiers.
  const tier = line.slice(line.indexOf("tier"));
  assert.ok(line.includes("tier"), "the correction addresses the tier split at all");
  assert.match(tier, /every repo in its tier|the whole tier|the rest of its tier/);
  assert.match(tier, /tier can change|changes tier|going public/);
});

test("onboarding says how a lapsed token is noticed and what its failure looks like", () => {
  const readme = readRepo(README);
  // One token per target is one expiry per target, so the page asking for them owes the reader the
  // notice and the symptom. The symptom is deliberately not pinned to a step name: the first step
  // that uses the token is a checkout in some workflows and a `gh` call in others.
  assert.match(readme, /expir|lapse/i);
  assert.match(readme, /first step that uses the token/);
  // What tells a lapsed token from a broken factory: it is one target, not all of them.
  assert.match(readme, /every other target keeps working/);
});

test("no page tells a reader that one token covers every target", () => {
  for (const file of repoFiles()) {
    for (const line of readRepo(file).split("\n")) {
      if (!/covers every target|one token .*every target|same token .*every target/.test(line)) continue;
      assert.ok(
        file === PIPELINE && line.includes(ORIGINAL_DECISION) && line.includes("Corrected 2026-09-11 (#252)"),
        `${file} still tells a reader one token covers every target: ${line.trim()}`,
      );
    }
  }
});
