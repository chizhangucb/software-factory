/**
 * The heartbeat's one decision, driven with a stand-in reader and waker and no
 * network, in the style of `dispatch/select.test.ts`: prepared state in, an
 * outcome per target out. A maintainer's question is which targets got woken,
 * which were skipped as idle and whether a failure was reported, so nothing
 * here reaches into how the pass is run.
 *
 * Which labels mean work is `work.test.ts`'s subject, tied there to the
 * factory's own definitions. These are the outcomes those rules produce.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { BLOCKED_LABEL, ESCALATION_LABEL, HOLD_LABEL, IMPLEMENT_LABEL, READY_LABEL } from "../lib/labels.ts";
import { type TargetOutcome, sendHeartbeat } from "./heartbeat.ts";
import { type OpenSubject } from "./work.ts";

/** An open ticket carrying these labels. */
const ticket = (...labels: string[]): OpenSubject => ({ pullRequest: false, labels });

/** An open pull request carrying these labels. */
const pullRequest = (...labels: string[]): OpenSubject => ({ pullRequest: true, labels });

/** A target with a ready ticket on it: work, whatever the rest of the pass is testing. */
const someWork = (): OpenSubject[] => [ticket(READY_LABEL)];

test("every target on the list is woken, and each gets one outcome", () => {
  const woken: string[] = [];
  const outcomes = sendHeartbeat({
    targets: ["owner/one", "owner/two"],
    readOpenWork: someWork,
    wake: (target) => woken.push(target),
    report: () => {},
  });
  assert.deepEqual(woken, ["owner/one", "owner/two"]);
  assert.deepEqual(outcomes, [
    { target: "owner/one", outcome: "woken" },
    { target: "owner/two", outcome: "woken" },
  ]);
});

test("a target that cannot be woken is reported, and the targets behind it are still woken", () => {
  const woken: string[] = [];
  const reported: TargetOutcome[] = [];
  const outcomes = sendHeartbeat({
    targets: ["owner/bad", "owner/two", "owner/three"],
    readOpenWork: someWork,
    wake: (target) => {
      if (target === "owner/bad") throw new Error("HTTP 404: Not Found");
      woken.push(target);
    },
    report: (outcome) => reported.push(outcome),
  });
  assert.deepEqual(woken, ["owner/two", "owner/three"]);
  assert.deepEqual(outcomes, [
    { target: "owner/bad", outcome: "failed", error: "HTTP 404: Not Found" },
    { target: "owner/two", outcome: "woken" },
    { target: "owner/three", outcome: "woken" },
  ]);
  // Reported as the pass runs, so the failure is on the report whether or not
  // anything reads the outcomes back.
  assert.deepEqual(reported, outcomes);
});

test("a target with nothing open is skipped as idle, and never woken", () => {
  const woken: string[] = [];
  const outcomes = sendHeartbeat({
    targets: ["owner/idle"],
    readOpenWork: () => [],
    wake: (target) => woken.push(target),
    report: () => {},
  });
  assert.deepEqual(woken, []);
  assert.deepEqual(outcomes, [{ target: "owner/idle", outcome: "skipped" }]);
});

/** One prepared target state, and the outcome a maintainer should see for it. */
const states: { state: string; open: OpenSubject[]; outcome: "woken" | "skipped" }[] = [
  { state: "a ready ticket", open: [ticket(READY_LABEL)], outcome: "woken" },
  { state: "a ticket in a factory state label", open: [ticket(IMPLEMENT_LABEL)], outcome: "woken" },
  // No factory label on it: the reconciler asks for a verdict on an unjudged
  // pull request whoever produced it, so this target is swept.
  { state: "an open pull request from a producer", open: [pullRequest()], outcome: "woken" },
  { state: "a held ready ticket", open: [ticket(READY_LABEL, HOLD_LABEL)], outcome: "skipped" },
  { state: "a held ticket in a factory state label", open: [ticket(IMPLEMENT_LABEL, HOLD_LABEL)], outcome: "skipped" },
  { state: "a parked ticket", open: [ticket(ESCALATION_LABEL)], outcome: "skipped" },
  { state: "a parked pull request", open: [pullRequest(BLOCKED_LABEL)], outcome: "skipped" },
];

for (const { state, open, outcome } of states) {
  test(`a target whose only open work is ${state} is ${outcome}`, () => {
    const woken: string[] = [];
    const outcomes = sendHeartbeat({
      targets: ["owner/one"],
      readOpenWork: () => open,
      wake: (target) => woken.push(target),
      report: () => {},
    });
    assert.deepEqual(outcomes, [{ target: "owner/one", outcome }]);
    assert.deepEqual(woken, outcome === "woken" ? ["owner/one"] : []);
  });
}

test("a target whose open work cannot be read is reported, and the targets behind it are still answered", () => {
  const woken: string[] = [];
  const reported: TargetOutcome[] = [];
  const outcomes = sendHeartbeat({
    targets: ["owner/unreadable", "owner/busy", "owner/idle"],
    readOpenWork: (target) => {
      if (target === "owner/unreadable") throw new Error("HTTP 403: Resource not accessible by personal access token");
      return target === "owner/busy" ? someWork() : [];
    },
    wake: (target) => woken.push(target),
    report: (outcome) => reported.push(outcome),
  });
  // Failed rather than woken anyway: a target nobody can read is a failure a
  // maintainer has to see, and waking it blind every interval would pay a
  // minute a pass to hide it.
  assert.deepEqual(woken, ["owner/busy"]);
  assert.deepEqual(outcomes, [
    { target: "owner/unreadable", outcome: "failed", error: "HTTP 403: Resource not accessible by personal access token" },
    { target: "owner/busy", outcome: "woken" },
    { target: "owner/idle", outcome: "skipped" },
  ]);
  assert.deepEqual(reported, outcomes);
});
