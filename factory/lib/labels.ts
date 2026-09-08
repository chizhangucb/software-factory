/**
 * The factory's label vocabulary: the strings the dispatcher, the retry
 * handler and the reconciler all read and write, in one place so they cannot
 * drift apart.
 *
 * `ready-for-agent` is a human's intent, `agent:*` is factory state (which
 * step holds the subject right now), `needs-human` is the factory giving up.
 *
 * Imports use explicit `.ts` and this module imports nothing, so the dispatch
 * job can run it on bare `node --experimental-strip-types` without
 * installing the engine.
 */

/** A human said this ticket is ready for the factory. */
export const READY_LABEL = "ready-for-agent";

/** The factory gave up on it; it is parked for a human. */
export const ESCALATION_LABEL = "needs-human";

const AGENT_LABEL_PREFIX = "agent:";

/** Factory state: which step holds this ticket or PR right now. */
export const isAgentLabel = (label: string): boolean => label.startsWith(AGENT_LABEL_PREFIX);

/** The `agent:*` labels among these, in the order given. */
export const agentLabels = (labels: readonly string[]): string[] => labels.filter(isAgentLabel);
