/**
 * The heartbeat (#222): one `factory-sweep` dispatch per target that has
 * something waiting, every interval (#212). The decision and nothing else, so
 * `send.ts` is where the real reader, waker and reporter are wired.
 *
 * A target that cannot be read or woken is reported and costs the targets
 * behind it nothing: a heartbeat that died on its first bad target would stop
 * the factory everywhere behind it.
 *
 * Nor is a target whose open work has nothing due (#264): open work is not the
 * same question as work a sweep would act on this pass, and the difference was
 * a billed minute per interval for as long as a subject sat there. `work.ts`
 * owns that rule and the reasoning behind it.
 *
 * A paused target is not woken either (#256). The caller gates every work job
 * on the same variable, so waking one bought a run whose only job was the
 * `paused` announcement: a billed minute per interval to say nothing was
 * happening. It leaves `merge-gate` and `audit` untouched, the two the pause
 * deliberately keeps running, because neither is driven by the heartbeat.
 *
 * Builtins only and explicit `.ts`, so `send.ts` runs on bare
 * `node --experimental-strip-types`.
 */
import { errorMessage } from "../lib/errors.ts";
import { type OpenSubject, sweepNeed } from "./work.ts";

/** What happened to one target in one pass. */
export type TargetOutcome =
  | { readonly target: string; readonly outcome: "woken" }
  /** Nothing is open on the target at all, so it was left asleep. */
  | { readonly target: string; readonly outcome: "skipped" }
  /**
   * Work is open and a sweep would find nothing to do on any of it this pass
   * (#264). Its own outcome rather than a `skipped`, for the reason the pause
   * has one: a working target reads as an idle estate otherwise, and these are
   * the passes a maintainer weighs the interval against.
   */
  | { readonly target: string; readonly outcome: "nothing-due" }
  /**
   * A human has paused the target, so it was left asleep whatever is open on
   * it. Its own outcome rather than a `skipped` with a note, because a pause
   * that reads as an idle target is how a forgotten pause goes unnoticed (#256).
   */
  | { readonly target: string; readonly outcome: "paused"; readonly reason: string }
  | { readonly target: string; readonly outcome: "failed"; readonly error: string };

/** What one pass needs: the targets, a way to read one, a way to wake one, a way to report. */
export type Pass = {
  /** The targets to consider, one line each in `targets.ts`. */
  readonly targets: readonly string[];
  /**
   * When this pass is running, which is what a deadline is measured against
   * (#264). Injected rather than read here, so a test drives the clock instead
   * of waiting on one.
   */
  readonly now: () => Date;
  /**
   * One target's pause reason, or nothing when it is running. Throwing fails
   * that target and no other; answering nothing is a target that is genuinely
   * not paused and never a read that went wrong (#256).
   */
  readonly readPause: (target: string) => string | undefined;
  /** Read one target's open tickets and pull requests. Throwing fails that target and no other. */
  readonly readOpenWork: (target: string) => readonly OpenSubject[];
  /** Wake one target. Throwing fails that target and no other. */
  readonly wake: (target: string) => void;
  /**
   * Where a maintainer sees what happened. Called as each target is answered,
   * not once at the end, so a pass that dies later has still reported what it
   * did.
   */
  readonly report: (outcome: TargetOutcome) => void;
};

/**
 * One target's outcome: the pause first, then what is open, then the wake only
 * if a sweep has something to do. Either read throwing fails the target rather
 * than waking it blind, so a token that cannot read a target says so on every
 * pass instead of paying a minute a pass to hide it.
 *
 * The pause is asked first because it settles the question on its own: a
 * paused target is not woken whatever is open on it, so reading its open work
 * would answer nothing (#256).
 */
const answerOne = (target: string, { now, readPause, readOpenWork, wake }: Pass): TargetOutcome => {
  try {
    const reason = readPause(target);
    if (reason !== undefined) return { target, outcome: "paused", reason };
    const need = sweepNeed(readOpenWork(target), now());
    if (need === "nothing-waiting") return { target, outcome: "skipped" };
    if (need === "nothing-due") return { target, outcome: "nothing-due" };
    wake(target);
    return { target, outcome: "woken" };
  } catch (error) {
    return { target, outcome: "failed", error: errorMessage(error) };
  }
};

/** One pass of the heartbeat: one outcome per target, in list order. */
export const sendHeartbeat = (pass: Pass): TargetOutcome[] =>
  pass.targets.map((target) => {
    const outcome = answerOne(target, pass);
    pass.report(outcome);
    return outcome;
  });
