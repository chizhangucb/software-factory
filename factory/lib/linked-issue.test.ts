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

test("a padded reference is the number GitHub reads it as, and the ticket keeps its digits", () => {
  // GitHub resolves `#007` to issue 7. The dispatcher compares numbers, so it
  // gets 7; the retry handler and the gate pass the ticket to `gh` as text, so
  // they keep what the body wrote.
  assert.deepEqual(issuesClosedBy("Closes #007"), [7]);
  assert.equal(linkedIssueNumber("Closes #007"), "007");
});
