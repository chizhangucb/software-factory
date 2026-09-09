import assert from "node:assert/strict";
import { test } from "node:test";

import { AUDIT_LIMIT, planAudit } from "./plan.ts";

test("a human PR the factory worked on is audited and counted", () => {
  const body = "Fixes the flaky login test.\n\n<!-- factory:verdict -->\n## Verdict: pass\n<!-- /factory:verdict -->";
  assert.deepEqual(planAudit({ audited: 4, merged: true, headRef: "chi/flaky-login", body }), {
    audit: true,
    next: 5,
    reason: "merged factory PR 5 of the first 20",
  });
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
