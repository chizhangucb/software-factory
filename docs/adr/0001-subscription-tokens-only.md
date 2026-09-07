---
status: accepted
date: 2026-09-06
---

# Subscription OAuth tokens only, no API keys

Chi's rule: as long as a subscription plan can do the work, use it, across as many accounts as needed, and avoid API billing. The factory therefore authenticates every agent run with per-account OAuth tokens from `claude setup-token`, one secret per account, rotated by the factory's own rotation module (ADR 0004). Anthropic's terms sanction these tokens inside Claude Code itself; driving the CLI through sandcastle's wrapper is a gray zone Anthropic may bill to usage credits or block at its discretion. We accept that knowingly because the cost difference is the difference between running the factory and not.

## Consequences

- The Agent SDK path is closed: tokens are refused there outright.
- Accounts must be distinct orgs; tokens in one org share a quota.
- The workflow keeps one seam so auth can flip to an API key with one secret change if Anthropic blocks subscription use.
- Vendor-native runners (Anthropic's official action and peers) are the fallback engine for the same reason.
