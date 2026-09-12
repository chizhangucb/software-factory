/**
 * The rule behind the interval (#261), which is the only reason the number is
 * 15 and not something else.
 *
 * The deadlines are imported rather than quoted, because the whole point is
 * that the interval follows from them: a test carrying its own copy of
 * `stuckMinutes` would agree with itself forever while the reconciler moved.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_DEADLINES } from "../dispatch/reconcile.ts";
import { HEARTBEAT_INTERVAL_MINUTES } from "./interval.ts";

/** The deadlines as a list, so a deadline added to the type is covered without being named here. */
const deadlines = (): number[] => Object.values(DEFAULT_DEADLINES);

test("the interval is no larger than the tightest reconciler deadline", () => {
  // A deadline is only ever checked when a sweep runs, so the interval is the
  // sampling rate for every one of them. An interval above the tightest turns
  // that deadline into a lower bound: at 30 minutes, a 15 minute stuck
  // deadline means somewhere between 15 and 45, which is not what the caller
  // input says and not what a maintainer reading it would expect.
  //
  // Asserted against the deadlines rather than against 15, so lowering
  // `stuckMinutes` fails here and forces the interval to be revisited, which
  // is the drift this ticket exists to stop.
  assert.ok(deadlines().length > 0, "the reconciler has deadlines to sample");
  assert.ok(
    HEARTBEAT_INTERVAL_MINUTES <= Math.min(...deadlines()),
    `the interval is ${HEARTBEAT_INTERVAL_MINUTES} minutes and the tightest deadline is ${Math.min(...deadlines())}`,
  );
});

test("the interval is the largest one the rule allows, so no sweep is paid for twice over", () => {
  // The other half of the rule. Below the tightest deadline the extra passes
  // buy no repair that the deadline itself has not already delayed, and each
  // one bills a minute on every target with work open. So the rule picks a
  // number rather than a range, and that number is the tightest deadline.
  assert.equal(HEARTBEAT_INTERVAL_MINUTES, Math.min(...deadlines()));
});

test("the interval is a whole number of minutes, which is what a scheduler takes", () => {
  // `StartInterval` is seconds and a cron is minutes; neither takes a fraction.
  assert.ok(Number.isInteger(HEARTBEAT_INTERVAL_MINUTES), `${HEARTBEAT_INTERVAL_MINUTES} is not a whole number of minutes`);
  assert.ok(HEARTBEAT_INTERVAL_MINUTES > 0, "an interval of zero or less is not a schedule");
});
