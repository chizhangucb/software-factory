/**
 * The factory asks `isFactoryAuthoredPr` before it closes a pull request or
 * puts the implementer on its branch (ADR 0003, 2026-09-11 amendment, #195).
 * The tree is the fixture, as in `lib/strip-types-cone.test.ts`: a table of
 * the sites that decide those writes and the modules that make them.
 *
 * It asserts the asking, never a shared answer. Escalation answers a PR the
 * factory did not author with `needs-human`, the other two sites with a
 * tell-author, so each answer is compared only with the same site's others.
 *
 * The limit, and it is not to be trusted past it: it pins the sites that
 * exist. It checks that each tabled site asks, and that the module making the
 * site's write calls the site, not which of its functions do or what they do
 * with the answer. A new write path that calls neither the predicate nor a
 * site is invisible here. What its author reads is the contract in
 * `factory/lib/factory-pr.ts`'s doc comment, which is why that stays the anchor.
 *
 * Not a site: update-branch's own update call. The 2026-09-10 amendment
 * applies it to any PR with auto-merge armed, since GitHub makes that merge
 * and no agent touches the branch.
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

/** Where the predicate is defined. It calls itself through `isFactoryPr`, which is not a site. */
const PREDICATE_MODULE = "factory/lib/factory-pr.ts";

/**
 * Every site that decides whether a PR is closed or gets the implementer, the
 * module that makes that write, and the site's decision called with everything
 * it reads besides who authored the PR held fixed. `planConflict` is given no
 * `HANDED_OFF_LABELS` label, since a PR carrying one is skipped before the
 * question is asked.
 */
const WRITE_SITES: readonly {
  module: string;
  site: string;
  writer: string;
  writes: string;
  decide: (pr: FactoryPrFacts) => unknown;
}[] = [
  {
    module: "factory/retry/escalation.ts",
    site: "prEscalation",
    writer: "factory/retry/retry.ts",
    writes: "closes the PR",
    decide: (pr) => prEscalation({ ...pr, labels: ["agent:review"] }),
  },
  {
    module: "factory/retry/escalation.ts",
    site: "prFix",
    writer: "factory/retry/retry.ts",
    writes: "puts the implementer on the branch",
    decide: (pr) => prFix(pr),
  },
  {
    module: "factory/update-branch/plan.ts",
    site: "planConflict",
    writer: "factory/update-branch/update-branch.ts",
    writes: "puts the implementer on the branch",
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

const siteKey = (module: string, site: string): string => `${module}#${site}`;

/** Every non-test TypeScript module under `factory/`, repo-relative. */
const factoryModules = (dir = "factory"): string[] =>
  fs.readdirSync(new URL(`${dir}/`, repoRoot), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : factoryModules(rel);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [rel] : [];
  });

/** Source with its comments blanked, so a doc comment that names a function is not read as a call. */
const codeOf = (module: string): string =>
  fs
    .readFileSync(new URL(module, repoRoot), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");

/** The repo-relative module `module` imports `name` from, by that name and unaliased, or undefined. */
const importedFrom = (module: string, name: string): string | undefined => {
  for (const [, names, from] of codeOf(module).matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
    if (names!.split(",").some((n) => n.trim().replace(/^type\s+/, "") === name)) {
      return path.posix.join(path.posix.dirname(module), from!);
    }
  }
  return undefined;
};

/**
 * `module#site` for every call to the predicate in the tree, named by the
 * top-level declaration it sits in, exported or not, so a tabled site that
 * stops asking is not credited with a call a helper below it makes.
 */
const callSites = (): string[] =>
  factoryModules()
    .filter((module) => module !== PREDICATE_MODULE)
    .flatMap((module) => {
      const code = codeOf(module);
      const decls = [...code.matchAll(/^(?:export\s+)?(?:const|let|function)\s+(\w+)/gm)];
      return [...code.matchAll(/\bisFactoryAuthoredPr\(/g)].map((call) =>
        siteKey(module, decls.filter((d) => d.index! < call.index!).at(-1)?.[1] ?? "(top level)"),
      );
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
    assert.ok(called.includes(siteKey(module, site)), `${site} in ${module} does not call isFactoryAuthoredPr`);
    assert.equal(importedFrom(module, "isFactoryAuthoredPr"), PREDICATE_MODULE, `${module} does not import isFactoryAuthoredPr from ${PREDICATE_MODULE}`);
  }
});

test("the module that makes each site's write calls the site", () => {
  // A site that asks protects nothing if the write goes round it, and that is
  // where #183's regression lived: retry.ts labelled the open PR
  // `agent:implement` itself, with no decision in between.
  for (const { module, site, writer } of WRITE_SITES) {
    assert.ok(new RegExp(`\\b${site}\\(`).test(codeOf(writer)), `${writer} makes the write ${site} decides without calling it`);
    assert.equal(importedFrom(writer, site), module, `${writer} does not import ${site} from ${module}`);
  }
});

test("the table names every call to isFactoryAuthoredPr in the tree, and nothing else", () => {
  // Both directions, as strip-types-cone's table does. A tabled site that stops
  // calling it drops out of the left, and a new caller nobody tabled shows up
  // there instead of going unchecked. A new write path that never calls it
  // appears on neither side: that is the limit the header names.
  assert.deepEqual(callSites(), WRITE_SITES.map(({ module, site }) => siteKey(module, site)).sort());
});
