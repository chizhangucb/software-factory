/**
 * The heartbeat (#222): one `factory-sweep` dispatch per target, every
 * interval. The decision and nothing else, so `send.ts` is where the real
 * waker and reporter are wired.
 *
 * A target that cannot be woken is reported and costs the targets behind it
 * nothing: a heartbeat that died on its first bad target would stop the
 * factory everywhere behind it.
 *
 * Builtins only and explicit `.ts`, so `send.ts` runs on bare
 * `node --experimental-strip-types`.
 */
import { errorMessage } from "../lib/errors.ts";

/** What happened to one target in one pass. */
export type TargetOutcome =
  | { readonly target: string; readonly outcome: "woken" }
  | { readonly target: string; readonly outcome: "failed"; readonly error: string };

/** What one pass needs: the targets, a way to wake one, a way to report. */
export type Pass = {
  /** The targets to wake, one line each in `targets.ts`. */
  readonly targets: readonly string[];
  /** Wake one target. Throwing fails that target and no other. */
  readonly wake: (target: string) => void;
  /**
   * Where a maintainer sees what happened. Called as each target is answered,
   * not once at the end, so a pass that dies later has still reported what it
   * did.
   */
  readonly report: (outcome: TargetOutcome) => void;
};

const wakeOne = (target: string, wake: Pass["wake"]): TargetOutcome => {
  try {
    wake(target);
    return { target, outcome: "woken" };
  } catch (error) {
    return { target, outcome: "failed", error: errorMessage(error) };
  }
};

/** One pass of the heartbeat: every target woken, one outcome each, in list order. */
export const sendHeartbeat = ({ targets, wake, report }: Pass): TargetOutcome[] =>
  targets.map((target) => {
    const outcome = wakeOne(target, wake);
    report(outcome);
    return outcome;
  });
