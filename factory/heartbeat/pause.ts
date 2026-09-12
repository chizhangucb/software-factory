/**
 * The pause, as the heartbeat reads it (#256), mirroring `waiver.ts`: the one
 * read it makes per target, and a pure function from what GitHub returns to
 * what the sender prints.
 *
 * A pause is a human's declaration that one target's factory starts and
 * advances no work. The caller gates every such job on the same variable, so
 * waking a paused target creates a run whose every work job is skipped: a
 * billed minute per interval to be told nothing is happening. Reading the
 * pause before the wake is what makes the brake stop metering.
 *
 * It never stops `merge-gate` or `audit`, because neither is driven by the
 * heartbeat: both fire on the target's own pull request events. Skipping the
 * wake removes the sweep and leaves those two exactly as they were
 * (`dispatch/triggers.test.ts` pins that).
 *
 * Only a human ever writes it, never the factory: `FACTORY_PAT` cannot write
 * repository variables, which is what stops the factory pausing or resuming
 * itself.
 *
 * Builtins only and explicit `.ts`, so `send.ts` reaches it on bare
 * `node --experimental-strip-types`.
 */
import { variableReadArgs } from "./variable.ts";

/** The repository variable holding the reason, beside `FACTORY_CHECKS_WAIVED`. */
export const PAUSE_VARIABLE = "FACTORY_PAUSED";

/**
 * What the line says when the variable is set but its value is only
 * whitespace. The target is paused, because the caller stops for it; what is
 * missing is the reason, and `paused ()` names nothing a maintainer can act on.
 */
const NO_REASON = "no reason given";

/**
 * The one read: a GET of the variable, with no `--method`, so asking whether a
 * target is paused cannot itself start a job on it. Unset is a 404, which
 * `variable.ts`'s `isUnset` tells from a read that genuinely failed.
 */
export const pauseReadArgs = (target: string): string[] => variableReadArgs(target, PAUSE_VARIABLE);

/**
 * Whether the target is paused, and why: the reason, or nothing when it is
 * running.
 *
 * The test for paused is the caller's own, `vars.FACTORY_PAUSED == ''`, which
 * is a string comparison: the empty value runs and everything else pauses,
 * whitespace included. So only the newline `gh` adds is taken off before that
 * question is asked. Trimming first and calling a whitespace value no pause is
 * how the two halves of one pause come apart, and it comes apart the expensive
 * way: every gated job on the target is skipped while the heartbeat goes on
 * waking it every interval, with the pass reporting it woken.
 *
 * The reason is then the value a human can read, which is the trimmed one, and
 * a value with nothing left in it after the trim keeps the pause and loses
 * only the reason.
 */
export const pauseReason = (raw: string): string | undefined => {
  const value = raw.replace(/\n$/, "");
  if (value === "") return undefined;
  return value.trim() || NO_REASON;
};

/**
 * What the sender prints for a target it did not wake. It says why, so a pause
 * left on by accident is visible in the pass rather than looking like an idle
 * target, which is how a forgotten pause goes unnoticed.
 */
export const pauseLine = (target: string, reason: string): string =>
  `${target} skipped: paused (${reason}); resume with \`gh variable delete ${PAUSE_VARIABLE} --repo ${target}\``;
