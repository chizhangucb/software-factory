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

/**
 * The deadlines the interval samples, as a list.
 *
 * Every member of `Deadlines` is a number of minutes today, so this takes all
 * of them rather than naming three and going stale when a fourth lands. The
 * test below pins the set, so a member added in some other unit, or one that
 * is not a deadline at all, fails here and is looked at rather than silently
 * tightening the interval.
 */
const deadlines = (): number[] => Object.values(DEFAULT_DEADLINES);

test("every deadline sampled is a deadline, in minutes, so taking all of them is safe", () => {
  // The set is pinned because the two tests below take `Object.values` of it.
  // A member added in seconds, or one that is not a deadline at all, would
  // pull the minimum down and tighten the interval with nobody deciding to.
  // Adding a deadline means adding it here, and the name says the unit.
  assert.deepEqual(Object.keys(DEFAULT_DEADLINES).sort(), ["stuckMinutes", "updateMinutes", "verdictMinutes"]);
  for (const [name, value] of Object.entries(DEFAULT_DEADLINES)) {
    assert.match(name, /Minutes$/, `${name} is sampled as minutes and is not named as minutes`);
    assert.ok(Number.isInteger(value) && value > 0, `${name} is ${value}, which is not a number of minutes`);
  }
});

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
