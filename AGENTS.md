# software-factory

- **Building or reviewing a ticket**: every ticket, no exceptions: `mattpocock-skills:tdd`, then `mattpocock-skills:code-review` on two axes, then the bundled `code-review`, by name. The order, and what makes each step done: `docs/agents/build-and-review.md`. It binds a subagent brief and an implementer run alike.
- **Naming a domain concept**, in a ticket title, a test name, a proposal, a commit message: `CONTEXT.md` is the glossary and `docs/adr/` holds the decisions. Read them as `docs/agents/domain.md` says, and flag an output that contradicts an ADR.
- **Creating, reading, labelling or closing a ticket**: GitHub Issues on `chizhangucb/software-factory`, driven with `gh`. Commands in `docs/agents/issue-tracker.md`; this repo's own rules, on closing and on what a ticket or PR body says, in `docs/agents/tracker-conventions.md`.
- **Applying a triage label**: the five canonical roles map to this repo's label strings in `docs/agents/triage-labels.md`.
