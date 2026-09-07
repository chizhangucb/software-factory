import assert from "node:assert/strict";
import { test } from "node:test";

import { AUDIT_LIMIT, isFactoryPr, planAudit } from "./plan.ts";

test("a factory PR is one on an agent/issue-* branch or one carrying the factory marker", () => {
  assert.equal(isFactoryPr({ headRef: "agent/issue-12-add-slugify", body: "" }), true);
  assert.equal(
    isFactoryPr({ headRef: "fix/typo", body: "Closes #3\n\nImplemented by the software factory. Run: x" }),
    true,
  );
  assert.equal(isFactoryPr({ headRef: "fix/typo", body: "Closes #3" }), false);
  assert.equal(isFactoryPr({ headRef: "agent/issues", body: "" }), false);
});

test("the first 20 merged factory PRs are audited, the counter advancing each time", () => {
  const first = planAudit({ audited: 0, merged: true, headRef: "agent/issue-1-a", body: "" });
  assert.deepEqual(first, { audit: true, next: 1, reason: "merged factory PR 1 of the first 20" });
  const twentieth = planAudit({ audited: 19, merged: true, headRef: "agent/issue-9-z", body: "" });
  assert.deepEqual(twentieth, { audit: true, next: 20, reason: "merged factory PR 20 of the first 20" });
});

test("after 20 the audit exits early and the counter stays", () => {
  assert.deepEqual(planAudit({ audited: 20, merged: true, headRef: "agent/issue-2-b", body: "" }), {
    audit: false,
    next: 20,
    reason: "audit limit reached: 20 merged factory PRs already audited, the first-20 audit is over",
  });
  assert.equal(planAudit({ audited: 35, merged: true, headRef: "agent/issue-2-b", body: "" }).next, 35);
});

test("a PR closed without merging, or not made by the factory, is neither audited nor counted", () => {
  assert.deepEqual(planAudit({ audited: 3, merged: false, headRef: "agent/issue-2-b", body: "" }), {
    audit: false,
    next: 3,
    reason: "PR was closed without merging",
  });
  assert.deepEqual(planAudit({ audited: 3, merged: true, headRef: "docs/readme", body: "hi" }), {
    audit: false,
    next: 3,
    reason: "not a factory PR (branch docs/readme, no factory marker in the body)",
  });
});

test("the limit is an input; a bad counter reads as zero", () => {
  assert.equal(AUDIT_LIMIT, 20);
  assert.deepEqual(planAudit({ audited: 2, merged: true, headRef: "agent/issue-1-a", body: "", limit: 3 }), {
    audit: true,
    next: 3,
    reason: "merged factory PR 3 of the first 3",
  });
  assert.equal(planAudit({ audited: Number.NaN, merged: true, headRef: "agent/issue-1-a", body: "" }).next, 1);
  assert.equal(planAudit({ audited: -4, merged: true, headRef: "agent/issue-1-a", body: "" }).next, 1);
});
