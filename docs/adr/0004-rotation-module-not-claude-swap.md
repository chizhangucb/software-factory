---
status: accepted
date: 2026-09-06
---

# A 60-line rotation module, with claude-swap as reference only

Ship one small Node module with two functions, `pickToken` and `isRateLimited`, reproducing claude-swap's ranking (most headroom, else earliest reset) and its run-result rate-limit detection, rather than importing claude-swap. The maintainer runs claude-swap 0.25.0 locally to rotate three subscription accounts, but it reads the interactive-login credential and GitHub runners cannot see it. Importing 23,000 lines of Python plus a runtime for three functions is a thin wrapper over a big foreign module, the opposite of a deep module.

Headroom ranking cannot ship on a runner: `GET /api/oauth/usage` returns 403 `oauth_scope_insufficient`, since `claude setup-token` mints inference-scoped tokens only. So rotation is rate-limit driven: `isRateLimited` reads the run's JSON result, and a rate-limited run re-runs on the next token. `pickToken` takes headroom as an optional injected input rather than fetching it, so quota-aware ranking is additive later (#24). With no headroom, it returns the lowest account not rate limited, so runs pile onto account 1 and rotation moves off only on a real rate limit. No cap bounds how many runs are in flight (the per-account cap was removed in #149, having insured against a wall nobody has hit); the workflows serialise one subject only, so two runs on the same ticket or PR never overlap. No cap of any shape returns until a real rate limit is observed, which is the trigger to design one from data.

## Considered Options

- **Import claude-swap on the runner and call its pure functions.** Rejected: a thin wrapper over a big foreign module, the opposite of a deep module.
- **cc-switch.** Ruled out: a GUI for API relay providers with no subscription-quota concept.
- **Store full OAuth credentials as the account secrets** (to restore headroom). Rejected: refresh tokens are single-use, a runner cannot write the rotated value back, concurrent runs would invalidate each other's credential (the maintainer's local claude-swap included), and it widens the secret from inference to the whole account session.

## Consequences

- Runs concentrate on one account until it walls, rather than pre-empting the wall. Accepted for v0.
- If the ranking ever needs to change, the reference is claude-swap's autoswitch candidate ranking.
