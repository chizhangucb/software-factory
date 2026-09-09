/**
 * Whether a closed PR gets the first-20 audit (#18, ADR 0003). Pure: the
 * workflow reads the counter from the target's factory state (state.sh:
 * .factory/state.json on the factory-state branch), asks this, and writes
 * `next` back.
 *
 * What counts as a factory PR is `factory/lib/factory-pr.ts`, the one
 * definition the reconciler reads too (#57 proposal 5). That module imports
 * nothing and this one imports only it, with an explicit `.ts` specifier, so
 * the decision step still runs on `node --experimental-strip-types` with no
 * install, like the dispatcher. The audit workflow's sparse-checkout cone
 * lists it.
 */
import { isFactoryPr } from "../lib/factory-pr.ts";

export const AUDIT_LIMIT = 20;

export interface AuditPlanInput {
  /** Merged factory PRs audited so far, from factory state. */
  readonly audited: number;
  readonly merged: boolean;
  readonly headRef: string;
  readonly body: string;
  readonly limit?: number;
}

export interface AuditPlan {
  readonly audit: boolean;
  /** The counter to store: advanced when this merge is audited, unchanged otherwise. */
  readonly next: number;
  readonly reason: string;
}

export const planAudit = (input: AuditPlanInput): AuditPlan => {
  const limit = input.limit ?? AUDIT_LIMIT;
  const audited =
    Number.isFinite(input.audited) && input.audited > 0 ? Math.floor(input.audited) : 0;
  if (!input.merged) {
    return { audit: false, next: audited, reason: "PR was closed without merging" };
  }
  if (!isFactoryPr(input)) {
    return {
      audit: false,
      next: audited,
      reason: `not a factory PR (branch ${input.headRef}, no factory marker or verdict section in the body)`,
    };
  }
  if (audited >= limit) {
    return {
      audit: false,
      next: audited,
      reason: `audit limit reached: ${audited} merged factory PRs already audited, the first-${limit} audit is over`,
    };
  }
  return {
    audit: true,
    next: audited + 1,
    reason: `merged factory PR ${audited + 1} of the first ${limit}`,
  };
};
