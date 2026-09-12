/**
 * Onboarding mints one token per target (#252). The subject is pages a maintainer reads, so the
 * files are the fixture, in the style of `judged-path-instruction.test.ts` beside it and
 * `lib/labels.test.ts` over the hold. The v0 decision that one `FACTORY_PAT` covers every target
 * (#20) is amended rather than deleted, so this pins the original sentence too: a correction that
 * replaces what it corrects loses the reasoning that was sound for the case it considered.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

/** A file in this repo, by its path from the root. */
const readRepo = (file: string): string => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

/** The pages under test: the onboarding step a maintainer follows, and the decision behind it. */
const README = "README.md";
const PIPELINE = "docs/pipeline.md";

/**
 * The v0 decision as #20 left it, copied out of `docs/pipeline.md` at the merge-base rather than
 * paraphrased. Preserved verbatim: the amendment adds a trigger beside it, it does not rewrite it.
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
  // The words a fine-grained PAT's own form uses, so the bullet is followable in the account UI.
  assert.match(bullet, /Only select repositories/);
  assert.match(bullet, /the target being onboarded/);
  assert.match(bullet, /nothing else/);
  // One per target, not one reused: the bullet has to say which of the two it means.
  assert.match(bullet, /one per target/i);
});

test("the pipeline note keeps the #20 sentence and carries a dated correction naming this ticket", () => {
  const line = decisionLine();
  // The repo's own correction form, as ADR 0003 and the notes above it use it.
  assert.match(line, /Corrected 2026-09-11 \(#252\)/);
  // The second trigger, beside ownership rather than in place of it.
  assert.ok(
    line.includes("owned by someone else"),
    "the correction leaves ownership standing as a trigger rather than replacing it",
  );
  assert.match(line, /reach/);
  assert.match(line, /visibilit/);
});

test("the correction says why per-target rather than a split by visibility tier", () => {
  const line = decisionLine();
  // A tier is the obvious cheaper answer, so the correction has to say what is wrong with it:
  // a token grouped by tier still reaches every repo in its tier, and a repo's tier can change.
  assert.match(line, /tier/);
  assert.match(line, /every repo in (its|that) tier/);
  assert.match(line, /tier can change/);
});

test("onboarding says how a lapsed token is noticed and what its failure looks like", () => {
  const readme = readRepo(README);
  // One token per target is one expiry per target, so the page that asks for them owes the reader
  // the symptom. The first step of every factory job is the one that uses the token.
  assert.match(readme, /expir/i);
  assert.match(readme, /Checkout factory/);
  // What tells a lapsed token from a broken factory: it is one target, not all of them.
  assert.match(readme, /every other target keeps working/);
});

test("no page tells a reader that one token covers every target", () => {
  // Named roots rather than a walk from the top: a checkout of this repo holds other sessions'
  // worktrees under `.claude/`. Test files are left out, since the pin above lives in one.
  const roots = ["README.md", "CONTEXT.md", "AGENTS.md", "CLAUDE.md", "docs", "templates", "scripts", "factory", ".github"];
  const files = (entry: string): string[] => {
    const url = new URL(`../../${entry}`, import.meta.url);
    if (!fs.existsSync(url)) return [];
    if (!fs.statSync(url).isDirectory()) return entry.endsWith(".test.ts") ? [] : [entry];
    return fs.readdirSync(url).flatMap((name) => (name === "node_modules" ? [] : files(`${entry}/${name}`)));
  };
  for (const file of roots.flatMap(files)) {
    for (const line of readRepo(file).split("\n")) {
      if (!/covers every target|one token .*every target|same token .*every target/.test(line)) continue;
      assert.ok(
        file === PIPELINE && line.includes(ORIGINAL_DECISION) && line.includes("Corrected 2026-09-11 (#252)"),
        `${file} still tells a reader one token covers every target: ${line.trim()}`,
      );
    }
  }
});
