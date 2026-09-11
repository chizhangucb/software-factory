/**
 * The factory asks `isFactoryAuthoredPr` before it closes a pull request or
 * puts an agent on its branch (ADR 0003, 2026-09-11 amendment, #195). The tree
 * is the fixture, in the style of `lib/strip-types-cone.test.ts`: a table of
 * the sites that make one of those writes, checked in both directions against
 * the modules that actually call the predicate, and each site's answer checked
 * against who authored the PR.
 *
 * What it asserts is the asking, never a shared answer. The sites do different
 * things once they know: escalation leaves a PR it did not author open with
 * `needs-human` instead of closing it, while the conflict decision and the
 * retry's fix both tell its author with `agent:blocked`. Two of the three share
 * a vocabulary and the third does not, so a test comparing answers across sites
 * would pass on two by coincidence and say nothing true about the third. Each
 * answer here is compared only with the same site's other answers.
 *
 * The limit, and the test is not to be trusted past it: it pins the sites that
 * exist. A new way for the factory to close a PR or put an agent on a branch
 * still has to choose to call the predicate, and one that never calls it is
 * invisible here, since a call is the thing this test looks for. So it catches
 * a known site that stops asking, or starts asking something else, and a new
 * site that asks without being tabled; it does not catch a new site that never
 * asks. What the author of a new write path reads is the contract in
 * `factory/lib/factory-pr.ts`'s doc comment, which is why that stays the anchor.
 *
 * Not a site, deliberately: update-branch's own update call. The 2026-09-10
 * amendment applies that to any PR with auto-merge armed, since it is GitHub
 * merging the base in and no agent touches the branch, so `planUpdate` asks
 * nothing about authorship and is right not to.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import { prEscalation, prFix } from "../retry/escalation.ts";
import { planConflict } from "../update-branch/plan.ts";
import {
  FACTORY_BODY_MARKER,
  type FactoryPrFacts,
  isFactoryAuthoredPr,
  isFactoryPr,
  VERDICT_SECTION_START,
} from "./factory-pr.ts";

const repoRoot = new URL("../../", import.meta.url);

/** The one definition, which calls itself through `isFactoryPr` and is not a site. */
const DEFINITION = "factory/lib/factory-pr.ts";

/**
 * Every site that closes a PR or puts an agent on its branch, with the write it
 * makes on the factory's own PR, and its decision called with everything it
 * reads besides who authored the PR held fixed. `planConflict` gets no label
 * that holds a PR, since a held PR is skipped before the question is asked.
 */
const WRITE_SITES: readonly {
  module: string;
  site: string;
  writes: string;
  decide: (pr: FactoryPrFacts) => unknown;
}[] = [
  {
    module: "factory/retry/escalation.ts",
    site: "prEscalation",
    writes: "closes the PR",
    decide: (pr) => prEscalation({ ...pr, labels: ["agent:review"] }),
  },
  {
    module: "factory/retry/escalation.ts",
    site: "prFix",
    writes: "makes a hand-off",
    decide: (pr) => prFix(pr),
  },
  {
    module: "factory/update-branch/plan.ts",
    site: "planConflict",
    writes: "makes a hand-off",
    decide: (pr) => planConflict({ ...pr, number: 7, labels: [] }),
  },
];

/**
 * PRs whose authorship is written down here rather than computed, so the
 * grouping below is not the predicate grading itself. Both of its arms, and
 * the PR that separates it from `isFactoryPr`: one the reviewer judged and the
 * factory did not open.
 */
const PRS: readonly { pr: FactoryPrFacts; authored: boolean }[] = [
  { authored: true, pr: { headRef: "agent/issue-12-add-slugify", body: "" } },
  { authored: true, pr: { headRef: "fix/typo", body: `${FACTORY_BODY_MARKER}. Run: x` } },
  { authored: true, pr: { headRef: "agent/issue-9-thing", body: `Does the thing.\n\n${VERDICT_SECTION_START}\npass` } },
  { authored: false, pr: { headRef: "maintainer/flaky-login", body: "Fixes the flaky login test." } },
  { authored: false, pr: { headRef: "maintainer/flaky-login", body: `Fixes it.\n\n${VERDICT_SECTION_START}\npass` } },
  { authored: false, pr: { headRef: "bot/dependabot-bump", body: "" } },
];

/** Every non-test TypeScript module under `factory/`, repo-relative. */
const factoryModules = (dir = "factory"): string[] =>
  fs.readdirSync(new URL(`${dir}/`, repoRoot), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : factoryModules(rel);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [rel] : [];
  });

/** Source with its comments blanked, so a doc comment that names the predicate is not read as a call. */
const codeOf = (module: string): string =>
  fs
    .readFileSync(new URL(module, repoRoot), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");

/** `module#site` for every call to the predicate in the tree, named by the exported const it sits in. */
const callSites = (): string[] =>
  factoryModules()
    .filter((module) => module !== DEFINITION)
    .flatMap((module) => {
      const code = codeOf(module);
      const exports = [...code.matchAll(/^export const (\w+)\s*[=:]/gm)];
      return [...code.matchAll(/\bisFactoryAuthoredPr\(/g)].map((call) => {
        const owner = exports.filter((e) => e.index! < call.index!).at(-1)?.[1] ?? "(top level)";
        return `${module}#${owner}`;
      });
    })
    .sort();

test("the PRs below are authored as written, and one of them is where the two predicates part", () => {
  // Guards the grouping the next test leans on. A corpus that lost either side,
  // or lost the judged PR the factory did not open, would let a site that asks
  // nothing, or asks `isFactoryPr`, pass.
  for (const { pr, authored } of PRS) assert.equal(isFactoryAuthoredPr(pr), authored, `${pr.headRef}: ${pr.body}`);
  assert.ok(PRS.some(({ authored }) => authored) && PRS.some(({ authored }) => !authored));
  assert.ok(PRS.some(({ pr, authored }) => !authored && isFactoryPr(pr)), "no judged PR the factory did not author");
});

test("each write site's answer turns on who authored the PR", () => {
  for (const { site, writes, decide } of WRITE_SITES) {
    const [mine, ...moreMine] = PRS.filter(({ authored }) => authored).map(({ pr }) => decide(pr));
    const [theirs, ...moreTheirs] = PRS.filter(({ authored }) => !authored).map(({ pr }) => decide(pr));
    // Within a side the answer is one answer: anything else means the site
    // decides on something besides authorship, `isFactoryPr` included.
    for (const other of moreMine) assert.deepEqual(other, mine, `${site} answers two PRs the factory authored differently`);
    for (const other of moreTheirs) assert.deepEqual(other, theirs, `${site} answers two PRs the factory did not author differently`);
    // Across sides it differs: a site that answers the same either way asked nothing.
    assert.notDeepEqual(theirs, mine, `${site} ${writes} whoever authored the PR`);
  }
});

test("each write site asks isFactoryAuthoredPr itself, imported from the one definition", () => {
  // The behaviour above is satisfied by a copy of the predicate's two arms too.
  // A copy is how the audit and the reconciler drifted before factory-pr.ts
  // existed, so the site has to call the definition, not match it today.
  const called = callSites();
  for (const { module, site } of WRITE_SITES) {
    assert.ok(called.includes(`${module}#${site}`), `${site} in ${module} does not call isFactoryAuthoredPr`);
    const imports = [...codeOf(module).matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)];
    const from = imports.find(([, names]) => /(^|[\s,])isFactoryAuthoredPr\s*(,|$)/.test(names!.trim()))?.[2];
    assert.ok(from, `${module} does not import isFactoryAuthoredPr by that name`);
    assert.equal(path.posix.join(path.posix.dirname(module), from), DEFINITION, `${module} imports isFactoryAuthoredPr from ${from}`);
  }
});

test("the table names every call to isFactoryAuthoredPr in the tree, and nothing else", () => {
  // Both directions, as strip-types-cone's table does. A tabled site that stops
  // calling it drops out of the left, and a new caller nobody tabled shows up
  // there instead of going unchecked. A new write path that never calls it
  // appears on neither side: that is the limit the header names.
  assert.deepEqual(callSites(), WRITE_SITES.map(({ module, site }) => `${module}#${site}`).sort());
});
