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

## Amendment, 2026-09-07: headroom ranking is not available on a runner

Verified against all three real account tokens in GitHub Actions: `GET https://api.anthropic.com/api/oauth/usage` returns 403 `oauth_scope_insufficient`, requiring the `user:profile` scope. `claude setup-token` mints inference-scoped tokens only; the same tokens complete a real `claude -p` call with `is_error: false`. claude-swap reads the interactive-login credential, which carries that scope, and the factory will not have it on a runner.

So the headroom half of pickToken cannot ship in v0. v0 rotation is rate-limit driven: isRateLimited reads the run's JSON result, and a rate-limited run re-runs once on the next token. pickToken takes headroom as an optional injected input rather than fetching it, so quota-aware ranking is additive later; the deferred design is #24.

Storing full OAuth credentials as the account secrets would restore headroom and is rejected: refresh tokens are single-use, a runner cannot write the rotated value back, and three concurrent runs per account would invalidate each other's credential, including the one Chi's local claude-swap depends on. It also widens the secret from inference to the whole account session, in a v0 with no sandbox inside the runner (ADR 0002) and auto-merge on from day one (ADR 0003).

### Consequences of the amendment

- The per-account concurrency cap of three becomes load-bearing: with no headroom ranking, it plus the rate-limit fallback is the only mechanism spreading load across accounts. Worth re-examining when throughput data exists; the 3 was a starting value from the baseline grill (#2), not a derived limit.
- Runs concentrate on one account until it walls, rather than pre-empting the wall. Accepted for v0.
