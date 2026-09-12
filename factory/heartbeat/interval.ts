/**
 * How often the heartbeat runs, and the one place that says so (#261).
 *
 * The factory cannot set its own interval: the sender is run by whatever a
 * host schedules it with, a launchd job on the maintainer's machine today
 * (#111 is where that lives for good). So this is documentation with a test on
 * it rather than a knob, and it exists because the number was previously prose
 * copied into a dozen files, which is a number that has already drifted.
 *
 * **The rule.** A deadline is only ever checked when a sweep runs, so the
 * interval is added to every one of them: a subject that crosses its deadline
 * waits up to one further interval for the sweep that repairs it. Repair lands
 * between D and D + I, for deadline D and interval I. There is no interval
 * that makes a deadline exact, and the choice is only how late is acceptable.
 *
 * The interval is the tightest deadline, which caps the worst case at twice
 * that deadline. That is a judgement and not an arithmetic necessity, and it
 * is worth stating plainly because the cheaper-sounding argument, that a
 * larger interval "stops the deadline being a deadline", is not true: at 15
 * and 15 a stuck subject is still repaired somewhere between 15 and 30
 * minutes. What changes with the interval is the multiple. At 10 it is 1.7
 * times the deadline, at 15 twice, at 30 three times, and the cost runs the
 * other way, a billed minute per pass on every target with work open.
 * Somewhere around twice is where this repo has settled; a target that wants
 * its repairs tighter buys that with passes.
 *
 * `interval.test.ts` holds both halves against `DEFAULT_DEADLINES`, so
 * changing a default deadline fails there rather than leaving this stale. A
 * target that overrides `stuck_minutes` in its own caller moves its own
 * deadline and not this number, so one set below the interval buys that
 * target no faster repair.
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
