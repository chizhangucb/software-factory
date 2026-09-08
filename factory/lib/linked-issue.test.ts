import assert from "node:assert/strict";
import { test } from "node:test";

import { linkedIssueNumber } from "./linked-issue";

test("linkedIssueNumber reads the closing keywords GitHub honours", () => {
  assert.equal(linkedIssueNumber("Closes #12\n\nImplemented by the factory."), "12");
  assert.equal(linkedIssueNumber("fixed: #7"), "7");
  assert.equal(linkedIssueNumber("Resolves #3 and closes #4"), "3");
  assert.equal(linkedIssueNumber("see #12"), "");
  assert.equal(linkedIssueNumber(null), "");
});
