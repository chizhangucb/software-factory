/**
 * The waiver nag (#244), mirroring `work.ts`: the one read the heartbeat makes
 * per target, and a pure function from what GitHub returns to what the sender
 * prints.
 *
 * A waiver is a human's declaration that the factory cannot run, so its checks
 * are not required on one target. Nothing clears one automatically, so the
 * heartbeat names an open one every run until a human closes it: a waiver
 * nobody is reminded of is the failure mode the nag exists to prevent.
 *
 * Only the factory ever reads it. Writing it is `scripts/waive-factory-checks.sh`
 * and a human, never this: a broken factory restoring its own required checks is
 * how a silent green happens.
 *
 * Builtins only and explicit `.ts`, so `send.ts` reaches it on bare
 * `node --experimental-strip-types`.
 */

import { variableReadArgs, variableValue } from "./variable.ts";

/** The repository variable holding the reason, beside `FACTORY_PAUSED`. */
export const WAIVER_VARIABLE = "FACTORY_CHECKS_WAIVED";

/**
 * The one read: a GET of the variable, with no `--method`, so asking whether a
 * target is waived cannot itself start a job on it. Unset is a 404, which
 * `variable.ts`'s `isUnset` tells from a read that genuinely failed.
 */
export const waiverReadArgs = (target: string): string[] => variableReadArgs(target, WAIVER_VARIABLE);

/** The variable's value, or nothing: a variable set to blank carries no reason to act on. */
export const waiverReason = (raw: string): string | undefined => variableValue(raw);

/**
 * What the sender prints for one target, or nothing when it is not waived. It says the
 * variable is set and no more: the ruleset is not read here, and a half-failed `on` or an
 * `onboard.sh` re-run leaves the variable set with the factory's checks required after all.
 */
export const waiverLine = (target: string, reason: string | undefined): string | undefined =>
  reason === undefined
    ? undefined
    : `${target} WAIVED: ${reason} (${WAIVER_VARIABLE} is set on the target; close it with \`scripts/waive-factory-checks.sh ${target} off\`)`;
