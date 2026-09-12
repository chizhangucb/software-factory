/**
 * How often the heartbeat runs, and the one place that says so (#261).
 *
 * The factory cannot set its own interval: the sender is run by whatever a
 * host schedules it with, a launchd job on the maintainer's machine today
 * (#111 is where that lives for good). So this is documentation with a test on
 * it rather than a knob, and it exists because the number was previously prose
 * copied into a dozen files, which is a number that has already drifted.
 *
 * **The rule.** The interval is the sampling rate for every reconciler
 * deadline, because a deadline is only ever checked when a sweep runs. So it
 * is the tightest of them:
 *
 * - Larger, and that deadline stops being a deadline. At 30 minutes a
 *   `stuckMinutes` of 15 means somewhere between 15 and 45, which is not what
 *   the caller input says.
 * - Smaller, and the extra passes buy no repair the deadline has not already
 *   delayed, while each one bills a minute on every target with work open.
 *
 * `interval.test.ts` holds both halves against `DEFAULT_DEADLINES`, so
 * changing a deadline fails there rather than leaving this stale.
 *
 * Builtins only, so it stays reachable from the sender's cone. It imports the
 * deadlines from nowhere: the tie to them is the test's, because that is where
 * a broken tie has to be answered by a human rather than followed silently.
 */

/**
 * 15 minutes, which is `stuckMinutes`, the tightest of the reconciler's
 * defaults.
 *
 * A literal and not `Math.min(...)` of them: derived, it would follow a
 * deadline anywhere it went and this file would never need reading again,
 * which is precisely the decision that should not be made silently. Lowering a
 * deadline fails the test instead, and a human picks the number.
 */
export const HEARTBEAT_INTERVAL_MINUTES = 15;

/**
 * The interval as the docs write it, so the one number reaches prose through a
 * test rather than by being retyped. `send.test.ts` holds both onboarding
 * pages to it.
 */
export const INTERVAL_PHRASE = `${HEARTBEAT_INTERVAL_MINUTES} minutes`;
