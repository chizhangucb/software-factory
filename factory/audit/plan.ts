/**
 * Whether a closed PR gets the first-20 audit (#18, ADR 0003). Pure: the
 * workflow reads the counter from the target's factory state (state.sh:
 * .factory/state.json on the factory-state branch), asks this, and writes
 * `next` back. No
 * imports, so the decision step runs on `node --experimental-strip-types`
 * with no install, like the dispatcher.
 */

export const AUDIT_LIMIT = 20;

/** Branch prefix implement.yml uses, and the body line it writes. Either marks a factory PR. */
export const FACTORY_BRANCH_PREFIX = "agent/issue-";
export const FACTORY_BODY_MARKER = "Implemented by the software factory";

export const isFactoryPr = (pr: { readonly headRef: string; readonly body: string }): boolean =>
  pr.headRef.startsWith(FACTORY_BRANCH_PREFIX) || pr.body.includes(FACTORY_BODY_MARKER);

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
      reason: `not a factory PR (branch ${input.headRef}, no factory marker in the body)`,
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
