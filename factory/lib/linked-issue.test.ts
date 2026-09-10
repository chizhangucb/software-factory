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
