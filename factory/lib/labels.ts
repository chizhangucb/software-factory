/**
 * The factory's label vocabulary: the strings the dispatcher, the retry
 * handler, the reconciler and update-branch read and write, here so that the
 * modules that import them cannot drift apart.
 *
 * `ready-for-agent` is a human's intent, `agent:*` is factory state (which
 * step holds the subject right now), `needs-human` is the factory giving up,
 * and `hold` is a human's instruction to leave a ready ticket alone.
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
 * A human said no agent starts on this ticket, whatever else it says: the
 * dispatcher does not dispatch it, the retry handler stands down rather than
 * retry it, and the reconciler leaves it and its PR alone rather than re-add a
 * start label (#185). Before #185 only the first of the three read it, so the
 * promise was the dispatcher's alone. Two hand-offs still do not read it. An
 * agent workflow that succeeds labels its PR `agent:review`, so a run already
 * going when the hold lands still gets its review. And update-branch's
 * conflict hand-off (`planConflict`) puts `agent:implement` on a conflicting,
 * armed, factory-authored PR carrying no `agent:*` label, held or not; a PR
 * the retry handler stood down on keeps `agent:in-progress` and is skipped
 * there already, so that gap is a held PR between stages. Unprefixed
 * because it is a human's instruction rather than factory state, so it belongs
 * next to `ready-for-agent` rather than in `agent:*`.
 *
 * It exists because holding a ready ticket back had no label of its own, so
 * people reached for `needs-triage` and it quietly became a veto: on chronicle
 * 14 tickets carried `needs-triage` + `ready-for-agent`, a triage pass read
 * that pair as drift, cleared it, and released 12 tickets into the factory at
 * once (#169). `hold` + `ready-for-agent` cannot be misread, because the label
 * says what it is for.
 */
export const HOLD_LABEL = "hold";

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

/**
 * Labels that stop an agent starting: read by the dispatcher
 * (`dispatch/select.ts`), the retry handler (`findHold` in `retry/decide.ts`)
 * and the reconciler (`dispatch/reconcile.ts`), from here, so those three cannot
 * disagree on what holds a ticket back. `hold` is the one to use; a human adds
 * it and removes it, and removing it releases the ticket on the next sweep.
 *
 * `ready-for-human` and `needs-triage` stay in the set as a backstop, not as
 * the way to hold something. Given correct labelling neither can fire: the
 * dispatcher only ever looks at tickets carrying `ready-for-agent`, and a
 * ticket that is genuinely somebody's to write by hand or genuinely untriaged
 * does not carry it. They are here so that the tickets already held by that
 * pair keep being held, with no window in which one is unprotected, and so
 * that the next person who reaches for `needs-triage` as a veto still gets
 * one.
 */
export const HOLD_LABELS: readonly string[] = [HOLD_LABEL, "ready-for-human", "needs-triage"];

/** Labels that say an agent already holds the subject (implementer or reviewer, running or queued) or that it is parked. */
export const HANDED_OFF_LABELS: readonly string[] = [IMPLEMENT_LABEL, IN_PROGRESS_LABEL, "agent:review", BLOCKED_LABEL];

/**
 * The two namespaces the factory writes labels in. A target's caller drops
 * the `unlabeled` events for both, so that the factory's own label removals
 * do not wake a sweep that re-stamps the ticket (#170), and
 * `dispatch/triggers.test.ts` pins the caller's clauses to these strings.
 * Renaming one here without renaming it in `templates/factory.yml` fails
 * that test rather than quietly restarting the loop.
 */
export const AGENT_LABEL_PREFIX = "agent:";
export const FACTORY_LABEL_PREFIX = "factory:";

/** Factory state: which step holds this ticket or PR right now. */
export const isAgentLabel = (label: string): boolean => label.startsWith(AGENT_LABEL_PREFIX);

/** The `agent:*` labels among these, in the order given. */
export const agentLabels = (labels: readonly string[]): string[] => labels.filter(isAgentLabel);
