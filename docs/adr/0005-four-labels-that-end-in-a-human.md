---
status: accepted
date: 2026-09-11
---

# Four labels that end in a human, and a dispatcher that reads only this repo's words

Four labels stop the factory and end with a person: `ready-for-human`, `hold`, `needs-human` and `agent:blocked`. They stay four. Two axes separate them and both are load-bearing: who wrote the label, and what else changed when it landed. `ready-for-human` and `hold` are a human's, written before or instead of the factory. `needs-human` and `agent:blocked` are the factory's, recording what happened to a run. Merge an intent with an outcome and nobody can tell from a ticket whether the factory ever touched it.

The second decision is about the vocabulary as a whole rather than these four: every label string the dispatcher decides on is one this repo defines, and a label GitHub ships by default must never become one of them.

## The four

- **`ready-for-human`.** A human's, applied at triage; one of the five triage roles in `docs/agents/triage-labels.md`. Tickets only. Nothing else changes when it lands: the factory never writes it and reads it only as a backstop member of the hold set (`hold`, `ready-for-human`, `needs-triage`), where it cannot normally fire, since the dispatcher only ever looks at tickets carrying `ready-for-agent`. A person clears it by doing the work, or by swapping labels to re-route the ticket to the factory.
- **`hold`.** A human's instruction to leave a ready ticket alone (#169). Tickets only. Nothing else changes: `ready-for-agent` stays on, and `hold` + `ready-for-agent` is a legitimate pair that reads as one. Removing it is the whole release, and the next sweep dispatches. `docs/agents/hold.md` is what a triager reads.
- **`needs-human`.** The factory's, and its one meaning is that the factory is done with this subject. On a ticket every `agent:*` label comes off and `ready-for-agent` with them, so an escalated ticket says one thing rather than two (`escalationLabels` in `factory/retry/escalation.ts`). On a PR it depends on who opened it: the retry handler closes a PR the factory authored and leaves the label to the ticket, and leaves a PR the factory did not author open with `needs-human` on it and auto-merge disarmed (`prEscalation`, #174); the reconciler's own escalation only ever relabels, parking the PR and its ticket alike. The audit opens a fresh `needs-human` issue on a miss. A person clears it by fixing the ticket, removing `needs-human` and `factory:retry-1`, then adding `ready-for-agent` back.
- **`agent:blocked`.** The factory's, and its one meaning is that a human must look (ADR 0003, amendments of 2026-09-10). Reaches tickets and PRs. Written where a job failed outside the implementer, where the retry handler itself could not run, or where a ticket was refused for having sub-issues. It is a note rather than a transition: it strips nothing, leaves `ready-for-agent` and any `factory:retry-N` where they are, and spends no retry. A person clears it by re-adding the label of the step that failed, `agent:implement` or `agent:review`, whichever the failure comment names; the run's own first step takes `agent:blocked` off, so nobody has to remove it by hand.

Both of the factory's two are read as well as written, which is most of why collapsing them would cost more than it saves. `PARKED_LABELS` in `factory/dispatch/reconcile.ts` is exactly the pair, and a parked subject is one the reconciler leaves alone instead of repairing. `agent:blocked` is also in `HANDED_OFF_LABELS`, which is what makes update-branch skip a conflicting PR somebody is already holding rather than handing it to the implementer again. Collapsing the two would mean recovering "does the factory still hold this" from the `agent:*` labels and "are retries left" from `factory:retry-N`, which is possible and is not worth the churn.

## The dispatcher reads only this repo's own vocabulary

The dispatcher decides on exact label strings, and every string it reads is one `scripts/onboard.sh` creates on a target: `ready-for-agent`, the hold set, the four `agent:*` states and `needs-human`. None of GitHub's nine default labels is among them. That was true by accident and is a decision now, with `factory/lib/labels.test.ts` failing if a default ever enters one of those lists.

A GitHub default carries a public meaning this repo does not control. `help wanted` means an outside contributor is welcome here, which is recruiting rather than routing, and a ticket can be `ready-for-human` and emphatically not want outside help. Wire a default into the hold set and everyone using it in its ordinary sense silently stops the factory, which is #169 with a wider blast radius: GitHub puts all nine on a repo before onboarding writes a single label of the factory's own, so the whole backlog arms at once without anyone having relabelled anything.

The near miss is `wontfix`, which is both a GitHub default and one of the five triage roles this repo maps in `docs/agents/triage-labels.md`, and which the dispatcher happens not to read.

## Considered options

- **One label for "a human has it".** Rejected on both axes above: a single label loses whether the factory ever ran, and merges a transition that strips a ticket's state with a note that strips nothing. The tracker is what a maintainer reads, and the question it has to answer at a glance is which of the two is true.
- **Prefixing every factory label so a collision with GitHub is impossible.** Rejected: `ready-for-agent`, `ready-for-human`, `needs-triage` and `needs-human` are the triage vocabulary a target's humans already use, and prefixing them would fork it, while `agent:` is reserved for factory state and is the wrong thing to say about a human's instruction, which is why `hold` is unprefixed. So the rule stays a decision, with a test behind it rather than a naming scheme.

## Consequences

- A fifth label that stops the factory and ends with a person amends this ADR, or it will be the one nobody can place.
- The guard test names GitHub's nine defaults as a literal list, so a tenth default GitHub ships in future is not covered until somebody adds it. That is the limit of a test over a list somebody else owns.
- The rule is about GitHub's defaults, not about collisions in general. `hold` is an ordinary English word and unprefixed, so a target may already use it for something of its own; onboarding rewrites labels with `--force`, and `docs/pipeline.md` is where that hazard is named.
- This repo carries no caller, so no dispatcher reads its own labels and all four are notes here rather than orders. The day it becomes a target is the day they start meaning what this ADR says they mean.
