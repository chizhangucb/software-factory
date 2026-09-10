/**
 * The factory's label vocabulary: the strings the dispatcher, the retry
 * handler, the reconciler and update-branch read and write, here so that the
 * modules that import them cannot drift apart.
 *
 * `ready-for-agent` is a human's intent, `agent:*` is factory state (which
 * step holds the subject right now), `needs-human` is the factory giving up.
 *
 * Not yet every home. `dispatch/select.ts` still spells `agent:implement` as
 * its own `DISPATCH_LABEL`, and its `FACTORY_STATE_LABELS` is
 * `HANDED_OFF_LABELS` plus `needs-human`. Repointing them is the dispatch
 * half of story 5 of #76 (#122), which owns that file; this module is where
 * they land when it does.
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

/**
 * Hand the subject to the implementer. On a ticket it starts an implement run;
 * on a PR it starts agent-implement-pr.yml, which works on the branch. The
 * dispatcher adds it to dispatch a ticket, the retry handler to start a retry,
 * and update-branch to a conflicting PR so the implementer merges the base in
 * and resolves.
 */
export const IMPLEMENT_LABEL = "agent:implement";

/** The factory is waiting on a human before this PR or ticket moves again. */
export const BLOCKED_LABEL = "agent:blocked";

/**
 * A run holds the subject right now. It is also what the reconciler sweeps on
 * a PR no run is left on, so a requeued PR keeps it and is picked up at the
 * stuck deadline (#148) rather than sitting with no `agent:*` label at all.
 */
export const IN_PROGRESS_LABEL = "agent:in-progress";

/** Labels that say an agent already holds the subject (implementer or reviewer, running or queued) or that it is parked. */
export const HANDED_OFF_LABELS: readonly string[] = [IMPLEMENT_LABEL, IN_PROGRESS_LABEL, "agent:review", BLOCKED_LABEL];

const AGENT_LABEL_PREFIX = "agent:";

/** Factory state: which step holds this ticket or PR right now. */
export const isAgentLabel = (label: string): boolean => label.startsWith(AGENT_LABEL_PREFIX);

/** The `agent:*` labels among these, in the order given. */
export const agentLabels = (labels: readonly string[]): string[] => labels.filter(isAgentLabel);
