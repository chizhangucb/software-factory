import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decide,
  escalationLabels,
  latestRetryContext,
  parseRetryComment,
  renderEscalationComment,
  renderRetryComment,
  retriesUsed,
  retryLabel,
  retryPromptSection,
} from "./decide";

test("retriesUsed counts the highest factory:retry-<n> label, zero without one", () => {
  assert.equal(retriesUsed([]), 0);
  assert.equal(retriesUsed(["ready-for-agent", "agent:in-progress"]), 0);
  assert.equal(retriesUsed(["factory:retry-1"]), 1);
  assert.equal(retriesUsed(["factory:retry-1", "factory:retry-2"]), 2);
  assert.equal(retriesUsed(["factory:retry-x", "factory:retry-"]), 0);
});

test("retryLabel names the label the workflow adds", () => {
  assert.equal(retryLabel(1), "factory:retry-1");
});

test("decide retries once on every failure kind, then escalates", () => {
  for (const kind of ["implement", "gate", "ci", "verdict"] as const) {
    assert.deepEqual(decide({ retriesUsed: 0, kind }), { action: "retry", attempt: 2 });
    assert.deepEqual(decide({ retriesUsed: 1, kind }), {
      action: "escalate",
      reason: "the retry failed too (2 attempts, 1 retry allowed)",
    });
    assert.equal(decide({ retriesUsed: 2, kind }).action, "escalate");
  }
});

test("decide does nothing on a ticket that is already escalated", () => {
  assert.deepEqual(decide({ retriesUsed: 0, kind: "gate", escalated: true }), {
    action: "none",
    reason: "already escalated: needs-human is on the ticket",
  });
});

test("escalationLabels lists every agent:* label to remove and needs-human to add", () => {
  assert.deepEqual(
    escalationLabels(["ready-for-agent", "agent:in-progress", "agent:blocked", "factory:retry-1"]),
    { remove: ["agent:in-progress", "agent:blocked"], add: "needs-human" },
  );
  assert.deepEqual(escalationLabels([]), { remove: [], add: "needs-human" });
});

const runUrl = "https://github.com/o/r/actions/runs/1";

test("a retry comment round-trips through its marker", () => {
  const body = renderRetryComment({
    attempt: 2,
    kind: "verdict",
    runUrl,
    output: "## Verdict: fail\n\n- [ ] the helper exists. Evidence: no file",
  });
  assert.match(body, /^<!-- factory:retry attempt=2 kind=verdict -->\n/);
  assert.match(body, /Retry 1 of 1/);
  assert.match(body, /Attempt 1 failed \(verdict\)\. Run: https:\/\/github\.com\/o\/r\/actions\/runs\/1/);
  const parsed = parseRetryComment(body);
  assert.ok(parsed);
  assert.equal(parsed.attempt, 2);
  assert.equal(parsed.kind, "verdict");
  assert.equal(parsed.runUrl, runUrl);
  assert.match(parsed.output, /- \[ \] the helper exists/);
});

test("parseRetryComment ignores comments without the marker", () => {
  assert.equal(parseRetryComment("just a comment"), undefined);
  assert.equal(parseRetryComment("<!-- factory:verdict -->\n## Verdict"), undefined);
});

test("a retry comment bounds long output and keeps its tail", () => {
  const output = `${"a".repeat(30_000)}\nTHE END`;
  const body = renderRetryComment({ attempt: 2, kind: "implement", runUrl, output });
  assert.ok(body.length < 20_000, `comment is ${body.length} chars`);
  assert.match(body, /characters cut/);
  assert.match(body, /THE END/);
});

test("latestRetryContext picks the newest marker comment and skips the rest", () => {
  const first = renderRetryComment({ attempt: 2, kind: "gate", runUrl, output: "old" });
  const second = renderRetryComment({ attempt: 2, kind: "verdict", runUrl, output: "new" });
  assert.equal(latestRetryContext([]), undefined);
  assert.equal(latestRetryContext(["hello", "world"]), undefined);
  assert.equal(latestRetryContext([first, "chatter", second])?.output.trim(), "new");
  assert.equal(latestRetryContext([second, first])?.kind, "gate");
});

test("retryPromptSection is empty without a context and names the failure with it", () => {
  assert.equal(retryPromptSection(undefined), "");
  const section = retryPromptSection({
    attempt: 2,
    kind: "gate",
    runUrl,
    output: "factory/red-green: no test failed on main",
  });
  assert.match(section, /^# RETRY: THE PREVIOUS ATTEMPT FAILED/);
  assert.match(section, /attempt 2 of 2/);
  assert.match(section, /failing check/);
  assert.match(section, /factory\/red-green: no test failed on main/);
});

test("renderEscalationComment links the run and the log, keeps the branch, names the closed PR", () => {
  const body = renderEscalationComment({
    issueNumber: "7",
    kind: "verdict",
    reason: "the retry failed too (2 attempts, 1 retry allowed)",
    summary: "verdict: 1/3 acceptance criteria met",
    runUrl,
    logUrl: "https://github.com/o/r/actions/runs/1/artifacts/9",
    branch: "agent/issue-7-thing",
    branchExists: true,
    closedPr: "12",
    output: "## Verdict: fail",
  });
  assert.match(body, /needs-human/);
  assert.match(body, /Run: https:\/\/github\.com\/o\/r\/actions\/runs\/1\b/);
  assert.match(body, /Run log: https:\/\/github\.com\/o\/r\/actions\/runs\/1\/artifacts\/9/);
  assert.match(body, /`agent\/issue-7-thing` is kept/);
  assert.match(body, /PR #12 was closed/);
  assert.match(body, /factory:retry-1/);
  assert.match(body, /## Verdict: fail/);
});

test("renderEscalationComment says when there is no branch and no PR", () => {
  const body = renderEscalationComment({
    issueNumber: "7",
    kind: "implement",
    reason: "the retry failed too (2 attempts, 1 retry allowed)",
    summary: "implement: no commits",
    runUrl,
    logUrl: undefined,
    branch: "agent/issue-7-thing",
    branchExists: false,
    closedPr: undefined,
    output: "",
  });
  assert.match(body, /No branch was pushed/);
  assert.match(body, /no PR was open/i);
  assert.match(body, /Run log: see the run/);
});
