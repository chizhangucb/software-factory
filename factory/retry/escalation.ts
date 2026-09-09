/**
 * What escalation leaves behind, as labels (#50). Pure: a subject's labels
 * in, the labels to remove and add out.
 *
 * Two paths escalate. The retry handler does it when the retry fails too,
 * and the reconciler (#35) does it when the event that starts a run is lost
 * twice, or when re-dispatching has hit its cap without the run ever
 * getting started. A human reading a parked ticket cannot tell which one did
 * it, so both ask here and a parked ticket looks the same either way.
 *
 * Imports use explicit `.ts` so the dispatch job can run this on bare `node
 * --experimental-strip-types` without installing the engine.
 */
import { agentLabels, ESCALATION_LABEL, isAgentLabel, READY_LABEL } from "../lib/labels.ts";

/**
 * Escalating: `needs-human` on, every `agent:*` label off, and
 * `ready-for-agent` off with them. The dispatcher refuses a ticket carrying
 * `needs-human`, so one that also still said "ready" said two things at
 * once. An escalated ticket shows one label and a human re-adds
 * `ready-for-agent` to rerun it.
 *
 * Only labels the subject carries are named, so no caller asks GitHub to
 * remove a label that is not there, and a PR, which never carries
 * `ready-for-agent`, loses only its `agent:*` ones.
 */
export const escalationLabels = (
  labels: readonly string[],
): { readonly remove: string[]; readonly add: typeof ESCALATION_LABEL } => ({
  remove: labels.filter((label) => isAgentLabel(label) || label === READY_LABEL),
  add: ESCALATION_LABEL,
});

/**
 * Closing a PR: every `agent:*` label off. A closed PR carries no state, and
 * closing it says nothing about the ticket, which keeps its own labels until
 * the escalation decides them.
 */
export const prCloseLabels = (labels: readonly string[]): { readonly remove: string[] } => ({
  remove: agentLabels(labels),
});
