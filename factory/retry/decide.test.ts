import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decide,
  isImplementerFailure,
  RATE_LIMITED_REASON,
  missingFailureReason,
  latestRetryContext,
  parseRetryComment,
  renderEscalationComment,
  renderRequeueComment,
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
    assert.deepEqual(decide({ retriesUsed: 0, kind }), { action: "retry", retry: 1 });
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

test("decide requeues a run rate limited on every account without spending the retry", () => {
  const decision = decide({ retriesUsed: 0, kind: "implement", requeue: RATE_LIMITED_REASON });
  assert.deepEqual(decision, { action: "requeue", reason: RATE_LIMITED_REASON });
  // The retry already used stays used, and the rate limit still does not count as the second failure.
  assert.equal(decide({ retriesUsed: 1, kind: "implement", requeue: RATE_LIMITED_REASON }).action, "requeue");
  assert.equal(
    decide({ retriesUsed: 0, kind: "implement", requeue: RATE_LIMITED_REASON, escalated: true }).action,
    "none",
  );
});

test("decide requeues a head still pending at the deadline without spending the retry", () => {
  const requeue = "check still pending after 15 minutes; not the ticket's failure";
  assert.deepEqual(decide({ retriesUsed: 0, kind: "ci", requeue }), { action: "requeue", reason: requeue });
  // The retry already used stays used: a slow CI is never the second failure that escalates.
  assert.equal(decide({ retriesUsed: 1, kind: "ci", requeue }).action, "requeue");
  assert.equal(decide({ retriesUsed: 0, kind: "ci", requeue, escalated: true }).action, "none");
  // Nothing pending: a real failure still spends the retry.
  assert.deepEqual(decide({ retriesUsed: 0, kind: "ci" }), { action: "retry", retry: 1 });
});

test("decide escalates at once on a failure a retry cannot fix", () => {
  assert.deepEqual(
    decide({ retriesUsed: 0, kind: "verdict", unretryable: "the ticket has no acceptance criteria" }),
    { action: "escalate", reason: "the ticket has no acceptance criteria" },
  );
});

test("the requeue comment says what moves the ticket or PR next", () => {
  const onTicket = renderRequeueComment({ reason: "r", runUrl: "u", onPr: false });
  assert.match(onTicket, /No retry was spent/);
  assert.match(onTicket, /dispatcher/);
  const onPr = renderRequeueComment({ reason: "r", runUrl: "u", onPr: true });
  assert.match(onPr, /agent:blocked/);
  // Both re-labels, since a requeue is not always the implementer's to pick up again.
  assert.match(onPr, /`agent:review`/);
  assert.match(onPr, /`agent:implement`/);
});

test("the requeue comment names the cause in its reason, never a rate limit it did not hit", () => {
  const body = renderRequeueComment({
    reason: "check still pending after 15 minutes; not the ticket's failure",
    runUrl: "u",
    onPr: true,
  });
  assert.match(body, /still pending after 15 minutes/);
  assert.doesNotMatch(body, /[Rr]ate limited/);
  assert.doesNotMatch(body, /quota/);
});

const runUrl = "https://github.com/o/r/actions/runs/1";

test("a retry comment round-trips through its marker", () => {
  const body = renderRetryComment({
    retry: 1,
    kind: "verdict",
    runUrl,
    output: "## Verdict: fail\n\n- [ ] the helper exists. Evidence: no file",
  });
  assert.match(body, /^<!-- factory:retry retry=1 kind=verdict -->\n/);
  assert.match(body, /Retry 1 of 1/);
  assert.match(body, /Attempt 1 failed \(verdict\)\. Run: https:\/\/github\.com\/o\/r\/actions\/runs\/1/);
  const parsed = parseRetryComment(body);
  assert.ok(parsed);
  assert.equal(parsed.retry, 1);
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
  const body = renderRetryComment({ retry: 1, kind: "implement", runUrl, output });
  assert.ok(body.length < 20_000, `comment is ${body.length} chars`);
  assert.match(body, /characters cut/);
  assert.match(body, /THE END/);
});

test("latestRetryContext picks the newest marker comment while the retry label matches it", () => {
  const first = renderRetryComment({ retry: 1, kind: "gate", runUrl, output: "old" });
  const second = renderRetryComment({ retry: 1, kind: "verdict", runUrl, output: "new" });
  const labels = ["ready-for-agent", "factory:retry-1"];
  assert.equal(latestRetryContext([], labels), undefined);
  assert.equal(latestRetryContext(["hello", "world"], labels), undefined);
  assert.equal(latestRetryContext([first, "chatter", second], labels)?.output.trim(), "new");
  assert.equal(latestRetryContext([second, first], labels)?.kind, "gate");
});

test("latestRetryContext is empty once the retry label is gone or names another cycle", () => {
  const marker = renderRetryComment({ retry: 1, kind: "verdict", runUrl, output: "stale" });
  assert.equal(latestRetryContext([marker], ["ready-for-agent"]), undefined, "handed back: fresh first attempt");
  assert.equal(latestRetryContext([marker], ["factory:retry-2"]), undefined, "marker from an older retry");
});

test("retryPromptSection is empty without a context and names the failure with it", () => {
  assert.equal(retryPromptSection(undefined), "");
  const section = retryPromptSection({
    retry: 1,
    kind: "gate",
    runUrl,
    output: "factory/red-green: no test failed on main",
  });
  assert.match(section, /^# RETRY: THE PREVIOUS ATTEMPT FAILED/);
  assert.match(section, /retry 1 of 1/);
  assert.match(section, /attempt 2 of 2/);
  assert.match(section, /failing check/);
  assert.match(section, /factory\/red-green: no test failed on main/);
});

test("renderEscalationComment links the run and the log, keeps the branch, names the closed PR", () => {
  const body = renderEscalationComment({
    issueNumber: "7",
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

test("the escalation comment asks for ready-for-agent back, since escalation took it off", () => {
  const body = renderEscalationComment({
    issueNumber: "7",
    reason: "the retry failed too (2 attempts, 1 retry allowed)",
    summary: "verdict: 1/3 acceptance criteria met",
    runUrl,
    logUrl: undefined,
    branch: "agent/issue-7-thing",
    branchExists: true,
    closedPr: "12",
    output: "",
  });
  assert.match(body, /remove `needs-human` and `factory:retry-1`, then add `ready-for-agent` back/);
});

test("renderEscalationComment says when there is no branch and no PR", () => {
  const body = renderEscalationComment({
    issueNumber: "7",
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

test("a run killed at the job timeout spends a retry, a failure around the implementer does not", () => {
  // The implementer's own attempt ended badly: this is what the one retry is for.
  assert.equal(isImplementerFailure("failure"), true);
  // `timeout-minutes` kills the job, and GitHub reports the killed step as cancelled (#51).
  assert.equal(isImplementerFailure("cancelled"), true);
  // A push, a PR step or a checkout failed around it: the blocked comment, not the retry.
  assert.equal(isImplementerFailure("skipped"), false);
  assert.equal(isImplementerFailure("success"), false);
  assert.equal(isImplementerFailure(""), false);
});

test("a killed attempt that wrote no reason file says it was killed", () => {
  assert.match(missingFailureReason("cancelled"), /killed/);
  assert.match(missingFailureReason("cancelled"), /timeout/);
  // Nothing killed it, so the reason really is missing and the log is where to look.
  assert.match(missingFailureReason("failure"), /no reason file/);
});
