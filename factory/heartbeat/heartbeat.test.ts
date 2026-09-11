/**
 * The heartbeat's one decision, driven with a stand-in waker and no network,
 * in the style of `dispatch/select.test.ts`: prepared state in, an outcome per
 * target out. A maintainer's question is which targets got woken and whether a
 * failure was reported, so nothing here reaches into how the pass is run.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { type TargetOutcome, sendHeartbeat } from "./heartbeat.ts";

test("every target on the list is woken, and each gets one outcome", () => {
  const woken: string[] = [];
  const outcomes = sendHeartbeat({
    targets: ["owner/one", "owner/two"],
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
  // The case the entry point exists for: a heartbeat that died on its first
  // bad target would stop the factory everywhere behind it.
  const woken: string[] = [];
  const reported: TargetOutcome[] = [];
  const outcomes = sendHeartbeat({
    targets: ["owner/bad", "owner/two", "owner/three"],
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
  // Reported where a maintainer sees it, not swallowed into a return value
  // nobody reads: the failure is on the report, whatever else the pass says.
  assert.deepEqual(reported, outcomes);
});
