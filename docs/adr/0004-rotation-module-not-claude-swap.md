---
status: accepted
date: 2026-09-06
---

# A 60-line rotation module, with claude-swap as reference only

Chi runs claude-swap 0.25.0 locally to rotate three subscription accounts. It polls Anthropic's OAuth usage endpoint per account, computes headroom from the 5-hour and 7-day windows, and switches before an account hits the wall. GitHub runners cannot see it. We considered importing the package on the runner and calling its pure functions, and rejected that: 23,000 lines of Python plus a runtime for three functions is a thin wrapper over a big foreign module, the opposite of a deep module. The factory ships one small Node module with two functions, pickToken and isRateLimited, whose internals reproduce claude-swap's ranking (most headroom, else earliest reset) and the run-result detection from Chi's own wrapper. cc-switch was ruled out: a GUI for API relay providers with no subscription-quota concept.

## Consequences

- One usage call per token per job; the endpoint has its own rate budget.
- A self-hosted runner on the Mini, where claude-swap already works, stays rejected (ADR 0002).
- If the ranking ever needs to change, the reference is claude-swap's autoswitch candidate ranking.
