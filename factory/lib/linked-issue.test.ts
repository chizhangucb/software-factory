import assert from "node:assert/strict";
import { test } from "node:test";

import { issuesClosedBy, linkedIssueNumber } from "./linked-issue";

test("linkedIssueNumber reads the closing keywords GitHub honours", () => {
  assert.equal(linkedIssueNumber("Closes #12\n\nImplemented by the factory."), "12");
  assert.equal(linkedIssueNumber("fixed: #7"), "7");
  assert.equal(linkedIssueNumber("Resolves #3 and closes #4"), "3");
  assert.equal(linkedIssueNumber("see #12"), "");
  assert.equal(linkedIssueNumber(null), "");
});

test("issuesClosedBy reads every ticket a body claims to close, not just the first", () => {
  assert.deepEqual(issuesClosedBy("Closes #4\n\nImplemented by the factory."), [4]);
  assert.deepEqual(issuesClosedBy("fixes #7 and Resolves: #8"), [7, 8]);
  assert.deepEqual(issuesClosedBy("See #9 for context"), []);
  assert.deepEqual(issuesClosedBy(null), []);
});

test("the one pattern both readers share carries no state from call to call", () => {
  // It is a global regex now, so a reader that used `exec` or `test` would
  // resume from the last match and answer differently the second time. Both
  // readers go through `matchAll`, which matches against a copy; these repeats
  // are what would fail if one of them stopped doing that.
  for (const pass of [1, 2, 3]) {
    assert.equal(linkedIssueNumber("Closes #12"), "12", `pass ${pass}`);
    assert.deepEqual(issuesClosedBy("fixes #7 and Resolves: #8"), [7, 8], `pass ${pass}`);
  }
});

test("a padded reference names the same ticket to both readers", () => {
  // GitHub resolves `#007` to issue 7 and auto-closes it on merge. The preflight
  // and the retry handler compare `linkedIssueNumber` against a canonical
  // number, so "007" would miss the PR the dispatcher already counts as
  // covering ticket 7, and the ticket would be neither dispatched nor claimed.
  assert.deepEqual(issuesClosedBy("Closes #007"), [7]);
  assert.equal(linkedIssueNumber("Closes #007"), "7");
  assert.deepEqual(issuesClosedBy("fixes #007 and Resolves: #0012"), [7, 12]);
});
