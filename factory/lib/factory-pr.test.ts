import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FACTORY_BODY_MARKER,
  FACTORY_BRANCH_PREFIX,
  isFactoryAuthoredPr,
  isFactoryPr,
  VERDICT_SECTION_START,
} from "./factory-pr.ts";

test("a PR the factory opened is one on an agent/ branch", () => {
  assert.equal(isFactoryPr({ headRef: "agent/issue-12-add-slugify", body: "" }), true);
  assert.equal(isFactoryPr({ headRef: "agent/anything", body: "" }), true);
  assert.equal(isFactoryPr({ headRef: "fix/typo", body: "Closes #3" }), false);
  assert.equal(isFactoryPr({ headRef: "not-agent/issue-1", body: "" }), false);
});

test("a PR the implementer opened carries the marker it writes in the body", () => {
  assert.equal(
    isFactoryPr({ headRef: "fix/typo", body: `Closes #3\n\n${FACTORY_BODY_MARKER}. Run: x` }),
    true,
  );
});

test("a human PR the factory worked on carries the reviewer's verdict section", () => {
  const body = [
    "Fixes the flaky login test.",
    "",
    VERDICT_SECTION_START,
    "## Verdict: pass",
    "<!-- /factory:verdict -->",
  ].join("\n");
  assert.equal(isFactoryPr({ headRef: "maintainer/flaky-login", body }), true);
});

test("a factory-authored PR is one the factory opened, never one it only worked on", () => {
  // The two arms the factory writes itself when it opens a PR.
  assert.equal(isFactoryAuthoredPr({ headRef: "agent/issue-12-add-slugify", body: "" }), true);
  assert.equal(isFactoryAuthoredPr({ headRef: "fix/typo", body: `${FACTORY_BODY_MARKER}. Run: x` }), true);
  // A human's PR the reviewer judged is a factory PR and is not factory-authored.
  // That gap is the whole point of the narrower predicate (#174).
  const judged = ["Fixes the flaky login test.", "", VERDICT_SECTION_START, "## Verdict: fail"].join("\n");
  assert.equal(isFactoryPr({ headRef: "maintainer/flaky-login", body: judged }), true);
  assert.equal(isFactoryAuthoredPr({ headRef: "maintainer/flaky-login", body: judged }), false);
  assert.equal(isFactoryAuthoredPr({ headRef: "docs/readme", body: "hi" }), false);
});

test("every factory-authored PR is a factory PR, so the two cannot drift apart", () => {
  const cases = [
    { headRef: "agent/issue-1-x", body: "" },
    { headRef: "fix/typo", body: FACTORY_BODY_MARKER },
    { headRef: "maintainer/thing", body: VERDICT_SECTION_START },
    { headRef: "docs/readme", body: "hi" },
  ];
  for (const pr of cases) {
    if (isFactoryAuthoredPr(pr)) assert.equal(isFactoryPr(pr), true, `${pr.headRef} is authored but not a factory PR`);
  }
});

test("the definition is the branch prefix, the body marker and the verdict section, nothing else", () => {
  assert.equal(FACTORY_BRANCH_PREFIX, "agent/");
  assert.equal(FACTORY_BODY_MARKER, "Implemented by the software factory");
  assert.equal(VERDICT_SECTION_START, "<!-- factory:verdict -->");
  assert.equal(isFactoryPr({ headRef: "docs/readme", body: "hi" }), false);
});
