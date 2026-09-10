import assert from "node:assert/strict";
import { test } from "node:test";

import {
  evaluateChecks,
  renderGateOutput,
  runIdFromUrl,
  stillPendingReason,
  summariseFailures,
  unretryableReason,
  waitOver,
} from "./checks";

const own = { workflowName: "factory", runId: "500" };

const status = (context: string, state: string, description = "") => ({
  context,
  state,
  description,
  target_url: `https://github.com/o/r/actions/runs/${context.length}`,
});

const checkRun = (
  name: string,
  status: string,
  conclusion: string | null,
  workflowName: string | undefined,
  runId = "77",
) => ({
  name,
  status,
  conclusion,
  html_url: `https://github.com/o/r/actions/runs/${runId}/job/9`,
  workflowName,
});

test("evaluateChecks: all green means nothing pending and nothing failing", () => {
  const result = evaluateChecks({
    statuses: [
      status("factory/verdict", "success"),
      status("factory/red-green", "success"),
      status("factory/test-integrity", "success"),
    ],
    checkRuns: [checkRun("check", "completed", "success", "check")],
    own,
  });
  assert.deepEqual(result, { pending: [], failures: [] });
});

test("evaluateChecks: a pending status or check run is reported as pending", () => {
  const result = evaluateChecks({
    statuses: [status("factory/red-green", "pending", "running")],
    checkRuns: [checkRun("check", "in_progress", null, "check")],
    own,
  });
  assert.deepEqual(result.pending, ["factory/red-green", "factory/test-integrity (not posted yet)", "check"]);
  assert.deepEqual(result.failures, []);
});

test("evaluateChecks: gate contexts that are not posted yet are pending, the gate run may still be queued", () => {
  const result = evaluateChecks({ statuses: [status("factory/verdict", "success")], checkRuns: [], own });
  assert.deepEqual(result.pending, [
    "factory/red-green (not posted yet)",
    "factory/test-integrity (not posted yet)",
  ]);
});

test("evaluateChecks: factory gate contexts fail as gate, other statuses and check runs as ci, verdict as verdict", () => {
  const result = evaluateChecks({
    statuses: [
      status("factory/verdict", "failure", "1/3 acceptance criteria met"),
      status("factory/red-green", "failure", "no changed test failed on main"),
      status("factory/test-integrity", "success"),
      status("ci/other", "error", "boom"),
    ],
    checkRuns: [checkRun("check", "completed", "failure", "check")],
    own,
  });
  assert.deepEqual(result.pending, []);
  assert.deepEqual(
    result.failures.map((f) => [f.name, f.kind]),
    [
      ["factory/red-green", "gate"],
      ["ci/other", "ci"],
      ["check", "ci"],
      ["factory/verdict", "verdict"],
    ],
  );
  const redGreen = result.failures[0];
  assert.equal(redGreen?.description, "no changed test failed on main");
  assert.equal(redGreen?.url, "https://github.com/o/r/actions/runs/17");
});

test("evaluateChecks: factory workflow check runs never fail the head but count as pending while running; this run is skipped", () => {
  const gate = [status("factory/red-green", "success"), status("factory/test-integrity", "success")];
  const result = evaluateChecks({
    statuses: gate,
    checkRuns: [
      checkRun("review / review", "in_progress", null, "factory", "500"),
      checkRun("gate / gate", "completed", "failure", "factory", "400"),
      checkRun("implement / implement", "completed", "failure", undefined, "500"),
      checkRun("check", "completed", "timed_out", "check"),
      checkRun("lint", "completed", "cancelled", "lint"),
      checkRun("optional", "completed", "neutral", "optional"),
    ],
    own,
  });
  assert.deepEqual(result.pending, []);
  const queued = evaluateChecks({
    statuses: gate,
    checkRuns: [checkRun("gate / gate", "queued", null, "factory", "400")],
    own,
  });
  assert.deepEqual(queued.pending, ["gate / gate"]);
  assert.deepEqual(
    result.failures.map((f) => [f.name, f.kind]),
    [["check", "ci"]],
  );
});

test("runIdFromUrl reads the run id out of run and job urls", () => {
  assert.equal(runIdFromUrl("https://github.com/o/r/actions/runs/123"), "123");
  assert.equal(runIdFromUrl("https://github.com/o/r/actions/runs/123/job/456"), "123");
  assert.equal(runIdFromUrl("https://github.com/o/r/actions/runs/123/attempts/2"), "123");
  assert.equal(runIdFromUrl("https://example.com/ci/9"), undefined);
  assert.equal(runIdFromUrl(null), undefined);
});

test("summariseFailures is one line naming each failure and its description", () => {
  assert.equal(
    summariseFailures([
      { name: "factory/red-green", kind: "gate", description: "no test failed on main", url: null },
      { name: "factory/verdict", kind: "verdict", description: "1/3 acceptance criteria met", url: null },
    ]),
    "gate factory/red-green (no test failed on main); verdict factory/verdict (1/3 acceptance criteria met)",
  );
});

test("renderGateOutput lists each check's reasons and the tails of the red-green logs", () => {
  const out = renderGateOutput(
    {
      redGreen: { ok: false, reasons: ["test/x.test.js passed on main"], exitCodes: { base: 0, head: 0 } },
      testIntegrity: { ok: true, reasons: [] },
    },
    { base: "line1\nline2\nline3", head: "ok" },
    2,
  );
  assert.match(out, /factory\/red-green: fail\n- test\/x\.test\.js passed on main/);
  assert.match(out, /factory\/test-integrity: pass/);
  assert.match(out, /on main \(expected to fail\), exit 0:\nline2\nline3/);
  assert.match(out, /on the head \(expected to pass\), exit 0:\nok/);
  assert.doesNotMatch(out, /line1/);
});

test("renderGateOutput without a red-green run shows only the verdicts", () => {
  const out = renderGateOutput({ testIntegrity: { ok: false, reasons: ["new skip/only/todo marker at test/a.test.js:3: test.skip(\"x\")"] } }, {});
  assert.equal(out, "factory/red-green: (not in gate.json)\nfactory/test-integrity: fail\n- new skip/only/todo marker at test/a.test.js:3: test.skip(\"x\")");
});

test("a verdict that failed for want of acceptance criteria is not worth a retry", () => {
  const noCriteria = { name: "factory/verdict", kind: "verdict" as const, description: "no acceptance criteria on the ticket", url: null };
  const unmet = { name: "factory/verdict", kind: "verdict" as const, description: "2/3 acceptance criteria met", url: null };
  const gate = { name: "factory/red-green", kind: "gate" as const, description: "source changed, no test", url: null };
  assert.match(unretryableReason([gate, noCriteria]) ?? "", /no acceptance criteria/);
  assert.equal(unretryableReason([gate, unmet]), undefined);
  assert.equal(unretryableReason([]), undefined);
});

test("a head still pending when the wait runs out is not the ticket's failure", () => {
  const reason = stillPendingReason({ pending: ["check", "factory/red-green"], failures: [] }, "UNKNOWN", 15);
  assert.match(reason ?? "", /check, factory\/red-green/);
  assert.match(reason ?? "", /15 minutes/);
  assert.match(reason ?? "", /not the ticket's failure/);
});

test("a check that failed outranks a pending one, so the failing path still runs with its log", () => {
  const state = evaluateChecks({
    statuses: [status("factory/red-green", "success"), status("factory/test-integrity", "success")],
    checkRuns: [checkRun("check", "completed", "failure", "check", "77"), checkRun("slow-ci", "in_progress", null, "ci")],
    own,
  });
  assert.deepEqual(state.pending, ["slow-ci"]);
  assert.equal(stillPendingReason(state, "MERGEABLE", 15), undefined);
  // The url the failure output pulls its log excerpt from survives.
  assert.equal(state.failures[0]?.url, "https://github.com/o/r/actions/runs/77/job/9");
  assert.equal(stillPendingReason({ pending: [], failures: [] }, "MERGEABLE", 15), undefined);
});

test("a definite conflict while checks are pending ends the wait, and the reason says the conflict ended it, not the deadline", () => {
  const pending = { pending: ["check", "factory/red-green (not posted yet)"], failures: [] };
  assert.equal(waitOver(pending, "CONFLICTING"), true);
  assert.equal(
    stillPendingReason(pending, "CONFLICTING", 15),
    "check, factory/red-green (not posted yet) still pending when GitHub reported the PR conflicting with its base, which ended the wait; not the ticket's failure",
  );
});

test("unknown and mergeable keep the wait going while checks are pending, as does no PR to read", () => {
  const pending = { pending: ["check"], failures: [] };
  assert.equal(waitOver(pending, "UNKNOWN"), false);
  assert.equal(waitOver(pending, "MERGEABLE"), false);
  assert.equal(waitOver(pending, undefined), false);
});

test("settled checks end the wait whatever GitHub says about the merge, with no requeue reason", () => {
  const settled = { pending: [], failures: [] };
  assert.equal(waitOver(settled, "CONFLICTING"), true);
  assert.equal(waitOver(settled, "UNKNOWN"), true);
  assert.equal(stillPendingReason(settled, "CONFLICTING", 15), undefined);
  const failed = { pending: [], failures: [{ name: "check", kind: "ci" as const, description: "failure", url: null }] };
  assert.equal(waitOver(failed, "CONFLICTING"), true);
});

test("a check that failed outranks the conflict: the wait still ends, but with no requeue reason, so the failure path runs", () => {
  const state = { pending: ["slow-ci"], failures: [{ name: "check", kind: "ci" as const, description: "failure", url: null }] };
  assert.equal(waitOver(state, "CONFLICTING"), true);
  assert.equal(stillPendingReason(state, "CONFLICTING", 15), undefined);
});
