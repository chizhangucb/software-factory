/**
 * The heartbeat (#222): one `factory-sweep` dispatch per target, every
 * interval, from outside GitHub because a caller's own `schedule` does not
 * reliably fire. This module is the decision and nothing else: given the
 * targets, a way to wake one and a way to report, it answers what happened to
 * each. `send.ts` is the runnable that wires the real waker and reporter.
 *
 * A target that cannot be woken is reported and costs the targets behind it
 * nothing: a heartbeat that died on its first bad target would stop the
 * factory everywhere behind it, which is worse than one target missing a
 * sweep.
 *
 * Builtins only, imported with explicit `.ts`, so a host runs `send.ts` on
 * bare `node --experimental-strip-types` with no `npm ci`.
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
  /** Where a maintainer sees what happened, called once per target. */
  readonly report: (outcome: TargetOutcome) => void;
};

/** What happened to one target: woken, or failed with what the waker said. */
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
