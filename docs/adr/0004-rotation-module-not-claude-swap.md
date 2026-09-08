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

## Note, 2026-09-07: how the cap and the rate-limit detection shipped (#17)

- Detection reads the raw `result` event. Claude Code 2.1.263 reports a usage limit as `subtype: "success"`, `is_error: true`, `api_error_status: 429`, with the limit text in `result` (`You've hit your session limit · resets ...`), and exits 0. `isRateLimited` accepts `is_error` plus either that status or the limit phrases Chi's local wrapper matches on; 401 and 403 auth failures and turn or budget caps are errors that do not rotate.
- The per-account cap is `per_account_slots` (default 3) on each reusable workflow, implemented as concurrency groups `account-slot-<i>`, `i` = issue or PR number mod N, computed by a tiny `slot` job because the concurrency key has no arithmetic. The group cannot carry the account number: secrets are invisible to concurrency expressions and the account is chosen inside the job. Since runs fill accounts in configured order and rotate only on a rate limit, N slots bounds runs in flight on any one account at N.
- Trade-off accepted: a GitHub concurrency group holds one running and one pending run. A third run arriving for a slot cancels the older pending one before any label moves, so the ticket stays on `agent:implement` with no run. The dispatcher's schedule fallback (#15) is what re-labels it. Slots are shared by implement, review, and implement-pr, so the cap counts every run kind.
- Forcing a rotation for the proof run: the caller repo variable `FACTORY_FORCE_RATE_LIMIT_ON` (comma-separated account indexes, unset by default) makes the script treat those accounts' first attempt in a job as rate limited, using the exact event shape above, without running the agent on them. An invalid spare token was rejected as the forcing mechanism: an auth error must never read as a rate limit. Amended for #19: an entry may be scoped to one run by name, `1@implement-65`, since the proof needs exactly one forced rotation and the variable is repo-wide.

## Amendment, 2026-09-08: the proof-run switch is deleted, the slot default is 5 (#49)

`FACTORY_FORCE_RATE_LIMIT_ON` was scaffolding for the #19 proof run, which passed. It is gone from the scripts and from all four agent workflows, so nothing can make an attempt read as rate limited without running the agent. Rotation now has one path: `isRateLimited` on the run's own result events. The note above records the switch as it was built; this is what replaced it, not a correction of it.

- Proving rotation again means a real rate limit, or the unit tests in `factory/lib/rotation.test.ts` and `factory/lib/accounts.test.ts`, which cover the pick order, the detection, and the re-run on the next account with nothing forced.
- `per_account_slots` defaults to 5, not the 3 the amendment above calls load-bearing. The 3 was a starting value from the baseline grill (#2); with no headroom ranking the slot cap is still the only thing spreading load, and 5 leaves less quota idle while usage data is collected (#46 story 21).
- The turn cap went with it (#49). `implementer_max_turns` and `factory/lib/turn-cap.ts` are gone and the provider handed to `sandcastle.run()` is sandcastle's own, so the only stops left on a run are the implement script's 30 minute idle timeout and the 60 minute job timeout. The two land differently. The idle timeout is an `AgentIdleTimeoutError` raised inside `sandcastle.run()`, so `settleRun` sees a failed attempt, `runWithRotation` calls `fail()`, the step's outcome is `failure`, and the retry handler does run. The 60 minute job timeout cancels the job instead, and GitHub reads `always()` as true on a cancellation, so the steps gated that way (`Upload run log`, `Always remove the accounts file`) still ran. What was skipped was every step gated on `failure()`: the retry handler, and `Keep partial work on failure` with it, so the branch was never pushed and no `factory:retry-*` marker was written. A cold restart that spent no retry budget. #51 moved the handler out of the implement job into a job of its own that `needs` it and runs `always()`, so both bounds now reach it; README's retry section carries the reasoning. `isRateLimited` is unaffected: a cap was never a rate limit.
