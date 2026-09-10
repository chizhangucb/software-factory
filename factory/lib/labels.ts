/**
 * The factory's label vocabulary: the strings the dispatcher, the retry
 * handler, the reconciler and update-branch all read and write, in one place
 * so they cannot drift apart.
 *
 * `ready-for-agent` is a human's intent, `agent:*` is factory state (which
 * step holds the subject right now), `needs-human` is the factory giving up.
 *
 * Imports use explicit `.ts` and this module imports nothing, so the dispatch
 * job and the update-branch job can both run it on bare
 * `node --experimental-strip-types` without installing the engine. Nothing
 * may be imported here: two sparse-checkout cones list this file and reach it
 * from a pure module, and an import either of them cannot resolve kills the
 * job with ERR_MODULE_NOT_FOUND.
 */

/** A human said this ticket is ready for the factory. */
export const READY_LABEL = "ready-for-agent";

/** The factory gave up on it; it is parked for a human. */
export const ESCALATION_LABEL = "needs-human";

/** Put on a conflicting PR so agent-implement-pr.yml merges the base into the branch and resolves. */
export const IMPLEMENT_LABEL = "agent:implement";

/** The factory is waiting on a human before this PR or ticket moves again. */
export const BLOCKED_LABEL = "agent:blocked";

/** Labels that say an agent already holds the subject (implementer or reviewer, running or queued) or that it is parked. */
export const HANDED_OFF_LABELS: readonly string[] = [IMPLEMENT_LABEL, "agent:in-progress", "agent:review", BLOCKED_LABEL];

const AGENT_LABEL_PREFIX = "agent:";

/** Factory state: which step holds this ticket or PR right now. */
export const isAgentLabel = (label: string): boolean => label.startsWith(AGENT_LABEL_PREFIX);

/** The `agent:*` labels among these, in the order given. */
export const agentLabels = (labels: readonly string[]): string[] => labels.filter(isAgentLabel);
