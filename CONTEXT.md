# Software Factory

Autonomous pipeline that turns well-scoped tickets into merged code with as little human time as possible. This file is the glossary: the words the specs, prompts, and docs all use for the same things. No implementation details live here.

## Language

**Spec**:
A grilled, human-approved description of a feature. Produced by a grilling session then /to-spec. The parent issue of its tickets.
_Avoid_: PRD (Matt's word, same thing), plan.

**Ticket**:
One vertical slice of a spec, sized to one fresh context window, carrying acceptance criteria. Produced by /to-tickets. The unit the factory picks up.
_Avoid_: task, issue (the tracker's word for the container), sub-issue.

**Acceptance criteria**:
The checklist on a ticket that says what done means. Written before any agent starts. The reviewer ticks each one with evidence.

**Run**:
One agent's attempt at one ticket in one fresh sandbox, ending in a PR or an escalation.
_Avoid_: iteration (Ralph's word for a loop pass), session.

**Gate**:
The mechanical checks a PR must pass before it can merge. Lives in CI as required status checks, never only in an agent prompt.
_Avoid_: verification, validation, definition of done (say gate plus acceptance criteria).

**Placeholder**:
Code that satisfies the gate without doing the work: a stub, a hardcoded return, a test that asserts the stub, a skipped or deleted test.
_Avoid_: cheating, slop.

**Escalation**:
A ticket the factory gives up on after its retry cap. Labeled for a human, branch kept, log attached. The only queue a human must read.
_Avoid_: failure, blocked (the tracker's dependency word).

**Target repo**:
A repo the factory is allowed to work on. First one is chronicle.
