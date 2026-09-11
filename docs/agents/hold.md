# Holding a ticket back

`hold` is how you say "ready, but not yet" to the factory. It is not one of the five triage roles in `triage-labels.md` and no skill applies it; a human adds it and a human takes it off.

The hold has a page of its own rather than a section in `triage-labels.md` because that page is vendored verbatim: `factory/plugins/README.md` keeps it byte-identical to the `setup-matt-pocock-skills` copy so a re-run of the skill is a no-op and a bump can re-copy it, and only the right-hand column of its table may be edited. Prose added there is prose the next bump silently deletes.

- **The dispatcher never dispatches a ticket carrying it**, whatever else the ticket says. `hold` + `ready-for-agent` is a legitimate pair and reads as one: the ticket is finished, and somebody is holding it.
- **Removing it is the whole release; nothing else has to be done to the ticket.** How soon is the sweep's, not the label's: taking it off fires `issues: unlabeled`, which wakes the dispatcher at once on a target whose caller subscribes to that action (`hold` is unprefixed, so it is outside the `agent:*` and `factory:*` namespaces a caller drops the removals of), and a target being sent `factory-sweep` every 10 minutes catches it within that interval if the event is lost. Ten minutes is the heartbeat's interval, not a guarantee GitHub makes and not a promise on a target nobody sends the heartbeat to, where it is whenever the caller's `schedule` next fires; `docs/pipeline.md` has the measurements and the trigger set a target can have drifted off.
- **`hold` is not `needs-triage`.** `needs-triage` means nobody has decided yet. Reach for `hold` when the decision is made and the answer is "not now", so that a triage pass reading `needs-triage` + `ready-for-agent` never has to guess which of the two somebody meant. That guess is what #169 is about: on chronicle a pass read the pair as drift on 14 tickets, cleared it, and released 12 into the factory at once.

The full hold set (`hold`, `ready-for-human`, `needs-triage`) is `HOLD_LABELS` in `factory/lib/labels.ts`, and the dispatcher reads it from there. The last two are a backstop and not the way to hold something: given correct labelling neither can fire, since the dispatcher only looks at tickets carrying `ready-for-agent` and neither of those belongs on one. They stay in the set so that tickets already held by the old `needs-triage` pair keep being held, with no window in which one is unprotected.

## These labels are notes here, and orders on a target

This repo carries no caller, so no dispatcher reads its labels: `ready-for-agent` here is a note between a maintainer and an interactive session. On a target repo the same label is a dispatch order.

So the hazard lands on the day a repo becomes a target, not on the day someone applies a label: the whole backlog arms at once, without anyone having relabelled anything. Sweeping it before the caller lands belongs to whoever adds the caller, and `docs/pipeline.md`'s onboarding details say what that sweep is.
