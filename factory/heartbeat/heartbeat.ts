/**
 * The heartbeat (#222): one `factory-sweep` dispatch per target that has
 * something waiting, every interval (#212). The decision and nothing else, so
 * `send.ts` is where the real reader, waker and reporter are wired.
 *
 * A target that cannot be read or woken is reported and costs the targets
 * behind it nothing: a heartbeat that died on its first bad target would stop
 * the factory everywhere behind it.
 *
 * Builtins only and explicit `.ts`, so `send.ts` runs on bare
 * `node --experimental-strip-types`.
 */
import { errorMessage } from "../lib/errors.ts";
import { type OpenSubject, needsSweep } from "./work.ts";

/** What happened to one target in one pass. */
export type TargetOutcome =
  | { readonly target: string; readonly outcome: "woken" }
  /** Nothing open needs a sweep, so the target was left asleep. */
  | { readonly target: string; readonly outcome: "skipped" }
  | { readonly target: string; readonly outcome: "failed"; readonly error: string };

/** What one pass needs: the targets, a way to read one, a way to wake one, a way to report. */
export type Pass = {
  /** The targets to consider, one line each in `targets.ts`. */
  readonly targets: readonly string[];
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
 * One target's outcome: read what is open, wake it only if a sweep has
 * something to do. A read that throws fails the target rather than waking it
 * blind, so a token that cannot read a target says so on every pass instead of
 * paying a minute a pass to hide it.
 */
const answerOne = (target: string, { readOpenWork, wake }: Pass): TargetOutcome => {
  try {
    if (!needsSweep(readOpenWork(target))) return { target, outcome: "skipped" };
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
