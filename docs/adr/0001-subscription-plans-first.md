---
status: accepted
date: 2026-09-06
---

# Subscription plans first, any vendor, API keys through the same seam

Decided 2026-09-06 under the title "Subscription OAuth tokens only, no API keys". Generalised 2026-09-08 (#46, story 24); the 2026-09-08 amendment is the operative rule. The text above the amendments is the decision as it was made, apart from three edits of 2026-09-08 that that amendment lists in full: one paragraph rewritten as plain fact (#46, story 25) and two Consequences bullets narrowed so they no longer say the ADR forbids what it now allows.

The rule: as long as a subscription plan can do the work, use it, across as many accounts as needed, and avoid API billing. The factory therefore authenticates every agent run with per-account OAuth tokens from `claude setup-token`, one secret per account, rotated by the factory's own rotation module (ADR 0004).

What the vendor's own documents say about that token, as of 2026-09-06 (sources and links in `docs/research/sandcastle-peers-2026-09.md`, section 5):

- `claude setup-token` is documented for CI pipelines and scripts and requires a Pro, Max, Team, or Enterprise plan. `CLAUDE_CODE_OAUTH_TOKEN` is the documented subscription input to Anthropic's own GitHub action.
- Anthropic's legal and compliance page says OAuth authentication is intended for ordinary use of Claude Code and other native Anthropic applications, and that developers building products or services, including on the Agent SDK, should use API key authentication.
- A support article says Anthropic may allow paid subscribers to use certain third-party tools, and reserves the right to draw that use from usage credits rather than from subscription limits.
- The June 2026 change that would have put `claude -p`, the Agent SDK, and GitHub Actions on a separate credit pool is marked paused, not withdrawn.
- No page states a rule for a harness that spawns the unmodified `claude` CLI, which is what sandcastle's wrapper and therefore this factory does. The research note reads the pages above as leaving that case under the support article's reserved right, and its per-option table gives sandcastle and its peers the verdict "not a sanctioned surface, subject to discretionary usage-credit billing or blocking".

That last bullet is the risk this decision runs, stated once and left as the source states it. The factory's answer to it is mechanical, not rhetorical: exactly one auth seam, so every path off subscription tokens is one secret change away.

## Considered options

- **API billing as the default.** Rejected: subscription billing is what makes the factory's volume affordable. A key is allowed through the same seam from 2026-09-08, but it is not the first choice.
- **A build on the Agent SDK.** Closed, for the reason the first consequence below gives: the SDK is the surface the vendor's compliance page points at API keys.

## Consequences

- The Agent SDK path is closed: subscription tokens are refused there outright.
- Accounts must be distinct orgs; tokens in one org share a quota.
- The workflow keeps one seam so auth can flip to an API key with one secret change.
- Vendor-native runners (Anthropic's official action and peers) are the fallback engine for the same reason.

## Amendments

### 2026-09-08: the rule comes off Claude and off tokens (#46, story 24)

The original title read "Subscription OAuth tokens only, no API keys" and the rule underneath it was Claude-shaped. Two things it forbade are now wanted: another vendor's subscription plan, and an API key. Neither is a violation of this ADR any more. Each is a configuration of the seam the ADR already required.

The rule, in three parts:

1. **A subscription plan first**, whichever vendor's, for as long as one can do the work. The reason is unchanged: subscription billing is what makes the factory's volume affordable.
2. **Any vendor.** The engine's agent slot already takes `codex`, `copilot`, `cursor`, `opencode`, and `pi` beside `claudeCode` (ADR 0002, and `docs/research/sandcastle-inventory-2026-09.md` section 2a lists them). An account is a secret plus the provider that reads it, so a Codex subscription is a second account kind, not a second design.
3. **An API key is allowed**, through the seam that already exists: the auth environment the workflow hands to the run. That seam is `claudeAgent()` in `factory/agent-workflows/shared/common.ts`, and today it takes subscription tokens only: it requires `CLAUDE_CODE_OAUTH_TOKEN` (or an account's token) and blanks `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` unconditionally. The first key-authenticated run therefore has to widen that one function to pass a key through when one is configured. Nothing else in the tree changes shape.

What this does not change:

- Rotation stays the mechanism for spreading load across subscription accounts (ADR 0004). An API key has no quota window to rotate around, so a key-authenticated run is a rotation of one.
- API-key environment variables stay blanked inside the agent process by default (`factory/agent-workflows/shared/common.ts`), and stay blanked outright until the seam is widened as point 3 says. That is what makes the workflow's auth the only way in: a key reaches a run because someone configured it at that seam, never because it happened to be in the environment.
- The Agent SDK path stays closed for subscription tokens.
- The file name changed with the title (`0001-subscription-tokens-only.md` to `0001-subscription-plans-first.md`). Two things link to the ADR by file name, the `cited-by:` front matter of `docs/research/sandcastle-peers-2026-09.md` and of `docs/research/sandcastle-inventory-2026-09.md`, and both carry the new name; a later rename has to move them too. Every other reference names the ADR by number, not by file: `docs/adr/0002-vendored-sandcastle-engine.md`, `factory/agent-workflows/shared/common.ts`, and `factory/lib/usage.ts` all say "ADR 0001".

Secret naming per vendor is a v1 note, not decided here. Today's names are Claude-shaped (`CLAUDE_CODE_OAUTH_TOKEN_<n>` secrets, `CLAUDE_ACCOUNT_<n>` variables), and the "Enumerate accounts" step of each agent workflow reads that prefix. A second vendor means a second prefix plus a provider input to choose between them. Naming that before a vendor actually runs would be guessing; story 25 of #9 owns the first real swap.

#### What was edited above, and what it said before

Three edits, all made on 2026-09-08, so that the text above does not contradict the rule in this amendment. Nothing else in the original was touched.

1. The paragraph rewritten for story 25 read: "Anthropic's terms sanction these tokens inside Claude Code itself; driving the CLI through sandcastle's wrapper is a gray zone Anthropic may bill to usage credits or block at its discretion. We accept that knowingly because the cost difference is the difference between running the factory and not." It is replaced by the bulleted quotation of what the sources actually say. The facts are the same; the ADR no longer characterises a vendor's future conduct.
2. The first Consequences bullet read "The Agent SDK path is closed: tokens are refused there outright." It now says "subscription tokens are refused there outright", because an API key on the Agent SDK is not what that bullet was about.
3. The third Consequences bullet read "so auth can flip to an API key with one secret change if Anthropic blocks subscription use". The trailing clause is gone: a key is now a configuration anyone may choose, not only a response to being blocked.

### 2026-09-09: one section shape across the four ADRs (#75, story 10)

All four ADRs now carry the same sections in the same order: front matter, title, the decision as made, `Considered options`, `Consequences`, then `Amendments` with one `###` per amendment, dated, oldest first, naming its ticket where the amendment's own text named one. A section inside an amendment is `####`. `Note` is gone as a heading; every appended section is an amendment, because that is what all of them were.

A correction to a single bullet stays inline in that bullet with its own date, and is not promoted to a section: 0003's "Amended 2026-09-07 (#19)" on the conflict bullet and 0004's "Amended for #19" on the forcing bullet both read as corrections to the sentence they sit in, and lifting them out would separate them from it.

Applied to this file:

- The `Amendment, 2026-09-08` heading moved under `Amendments` as `2026-09-08: the rule comes off Claude and off tokens (#46, story 24)`, and `What was edited above, and what it said before` moved from `###` to `####` with it. Its text is unchanged apart from one move: its opening sentence read "Two things it forbade are now wanted (#46, story 24)", and that citation is now in the heading instead. The opening paragraph of the ADR still carries it too.
- `Considered options` is new. Both entries come from alternatives this ADR's own 2026-09-06 text already recorded, the avoidance of API billing in the rule and the closed Agent SDK path in Consequences. Nothing new was weighed and nothing moved out of Consequences.
- The opening paragraph attributed the rule to the maintainer by name. It now opens "The rule", and the sentence pointing at the operative amendment names it by date rather than as "the amendment at the bottom", since there is more than one.

Nothing else was cut from this file. Every decision, date, ticket, source bullet and consequence it recorded on 2026-09-08 is still here.
