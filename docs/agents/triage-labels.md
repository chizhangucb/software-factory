# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Holding a ticket back

`hold` is how you say "ready, but not yet" to the factory. It is not one of the five roles above and no skill applies it; a human adds it and a human takes it off.

- **The dispatcher never dispatches a ticket carrying it**, whatever else the ticket says. `hold` + `ready-for-agent` is a legitimate pair and reads as one: the ticket is finished, and somebody is holding it.
- **Removing it releases the ticket on the next sweep, which is within ten minutes.** Taking the label off wakes the dispatcher straight away, and the sweep catches it anyway if that event goes missing. Nothing else has to be done to the ticket. The ten minutes is the heartbeat's interval rather than a guarantee GitHub makes, so on a target nobody is sending `factory-sweep` to it is whenever the caller's `schedule` next fires; `docs/pipeline.md` has the measurements.
- **`hold` is not `needs-triage`.** `needs-triage` means nobody has decided yet. Reach for `hold` when the decision is made and the answer is "not now", so that a triage pass reading `needs-triage` + `ready-for-agent` never has to guess which of the two somebody meant. That guess is what #169 is about: on chronicle a pass read the pair as drift on 14 tickets, cleared it, and released 12 into the factory at once.

The full hold set (`hold`, `ready-for-human`, `needs-triage`) is `HOLD_LABELS` in `factory/lib/labels.ts`, and the dispatcher reads it from there. The last two are a backstop and not the way to hold something: given correct labelling neither can fire, since the dispatcher only looks at tickets carrying `ready-for-agent` and neither of those belongs on one. They stay in the set so that tickets already held by the old `needs-triage` pair keep being held, with no window in which one is unprotected.

## These labels are notes here, and orders on a target

This repo carries no caller, so no dispatcher reads its labels: `ready-for-agent` here is a note between a maintainer and an interactive session. On a target repo the same label is a dispatch order.

So the hazard lands on the day a repo becomes a target, not on the day someone applies a label: the whole backlog arms at once, without anyone having relabelled anything. Sweeping it before the caller lands belongs to whoever adds the caller, and `docs/pipeline.md`'s onboarding details say what that sweep is.
