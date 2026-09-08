/**
 * What escalation leaves behind, as labels (#50). Pure: a subject's labels
 * in, the labels to remove and add out.
 *
 * Two paths escalate. The retry handler does it when the retry fails too,
 * and the reconciler (#35) does it when the event that starts a run is lost
 * twice. A human reading a parked ticket cannot tell which one did it, so
 * both ask here and a parked ticket looks the same either way.
 *
 * Imports use explicit `.ts` so the dispatch job can run this on bare `node
 * --experimental-strip-types` without installing the engine.
 */
import { READY_LABEL } from "../dispatch/select.ts";

export const ESCALATION_LABEL = "needs-human";

const AGENT_LABEL_PREFIX = "agent:";

/** Factory state on a ticket or PR: which step holds it right now. */
const isAgentLabel = (label: string): boolean => label.startsWith(AGENT_LABEL_PREFIX);

/**
 * Escalating: `needs-human` on, every `agent:*` label off, and
 * `ready-for-agent` off with them. The dispatcher refuses a ticket carrying
 * `needs-human`, so one that also still said "ready" said two things at
 * once. An escalated ticket shows one label and a human re-adds
 * `ready-for-agent` to rerun it.
 *
 * Only labels the subject carries are named, so no caller asks GitHub to
 * remove a label that is not there.
 */
export const escalationLabels = (
  labels: readonly string[],
): { readonly remove: string[]; readonly add: typeof ESCALATION_LABEL } => ({
  remove: labels.filter((label) => isAgentLabel(label) || label === READY_LABEL),
  add: ESCALATION_LABEL,
});

/**
 * Closing a PR: every `agent:*` label off. A closed PR carries no state.
 * `ready-for-agent` is the ticket's intent and never the PR's, so this
 * touches only the factory's own labels.
 */
export const prCloseLabels = (labels: readonly string[]): { readonly remove: string[] } => ({
  remove: labels.filter(isAgentLabel),
});
