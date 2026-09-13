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
  // A deadline is only ever checked when a sweep runs, so a subject that
  // crosses one waits up to a further interval for the sweep that repairs it:
  // repair lands between D and D + I. Holding the interval at or below the
  // tightest deadline is what caps the worst case at twice that deadline,
  // which is the trade this repo has taken. It does not make the deadline
  // exact, and `interval.ts` says so rather than claiming it does.
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
  // The other half of the rule, and the half that is a choice rather than a
  // bound. A shorter interval does buy faster repair, proportionally: the
  // worst case is D + I either way. What it costs is a billed minute per pass
  // on every target with work open, which is why the rule picks the top of the
  // range it allows rather than anywhere inside it.
  assert.equal(HEARTBEAT_INTERVAL_MINUTES, Math.min(...deadlines()));
});

test("the interval is 30 minutes, the number a human moved it to alongside the deadlines (#271)", () => {
  // The literal the deadlines were raised to meet: stuck moved from 15 to 30, so
  // the tightest deadline is 30 and the rule lets the interval sit there.
  assert.equal(HEARTBEAT_INTERVAL_MINUTES, 30);
});

test("the interval is a whole number of minutes, which is what a scheduler takes", () => {
  // `StartInterval` is seconds and a cron is minutes; neither takes a fraction.
  assert.ok(Number.isInteger(HEARTBEAT_INTERVAL_MINUTES), `${HEARTBEAT_INTERVAL_MINUTES} is not a whole number of minutes`);
  assert.ok(HEARTBEAT_INTERVAL_MINUTES > 0, "an interval of zero or less is not a schedule");
});
