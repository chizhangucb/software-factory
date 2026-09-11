# software-factory

Reusable GitHub Actions workflows that turn a labeled ticket into a merged PR with no human in the path. A maintainer writes the ticket and reads what the factory escalates; everything in between is agents and required status checks.

The factory lives in this repo. A target repo carries one workflow file that calls it.

## How a ticket becomes a merge

1. A maintainer labels a ticket `ready-for-agent`.
2. The **dispatcher** picks it up once every blocker is closed and adds `agent:implement`.
3. The **implementer** builds it on `agent/issue-N-<slug>` and opens a PR with `Closes #N` and auto-merge already enabled.
4. The **merge gate** runs no agent. It posts `factory/red-green` and `factory/test-integrity` on the PR head, alongside the target's own CI.
5. The **reviewer** judges the head against the ticket's acceptance criteria and posts `factory/verdict`.
6. **Auto-merge** squashes the PR once every required check is green. Nothing else touches the merge button.
7. **update-branch** keeps auto-merge PRs current as main moves, and hands a real conflict back to the implementer.
8. The **audit** re-reviews each of the first 20 merges and opens a revert PR on a miss.

A failing implementer run or check in steps 3 to 5 earns one informed retry, then escalates to `needs-human`. `docs/pipeline.md` has every stage in full, including the failures that spend no retry.

## Onboard a target repo

1. **Copy the caller.** `templates/factory.yml` goes to `.github/workflows/factory.yml` in the target. That file is the only factory file the target carries. Every job passes `factory_ref`, and it must equal the ref in that job's `uses:`, both `main` in the template. Change one without the other and they drift.

   A target with two kinds of test needs one more thing here: a **routing test command**, so the merge gate runs each kind with the command that kind needs. Copy `templates/routing-test-command.sh` into the target, say as `scripts/factory-test-command.sh`, edit its one mapping, keep it executable, and name that path in the merge-gate job's `test_command`. Land it on the default branch with the caller: the merge gate runs the test command on a checkout of the base branch too, so until it is there the base side fails for want of the file rather than for want of the test. Without it both kinds get the default, the second kind dies on import, and the merge gate passes those files over with nothing proved. A target with one kind of test needs nothing.

   Every target also needs one line, a line rather than a file: `templates/agents-md-judged-path.md` holds it, and it goes into the target's `AGENTS.md` (or `CLAUDE.md`) as it stands. Anything but the factory that opens a PR on the target, an interactive session or a cloud agent, has to put `Closes #N` in the body, `agent:review` on the PR and auto-merge on it, or the PR sits blocked on `factory/verdict` for good. That line is how it knows to do all three without being asked, and it is ADR 0003's judged path. Landing it is the target's own PR, and on a repo carrying a caller `scripts/onboard.sh` (step 3) prints the line again when it finishes.

2. **Add the secrets.**
   - `FACTORY_PAT`, a fine-grained PAT, so pushes trigger the target's CI. It needs contents, issues, pull requests and workflows write.
   - One `CLAUDE_CODE_OAUTH_TOKEN_<n>` per subscription account, from `claude setup-token`. Adding an account later is adding one more secret. Optional: a `CLAUDE_ACCOUNT_<n>` variable naming each account for you. The factory never publishes it: not in the job log, the usage comment, an escalation comment, an attached log or an uploaded artifact, all of which are world-readable on a public target. Every one of those names the account by its `<n>` instead. The label appears only in `usage.json` on the runner.

   Step 1 lands the caller before this step adds `FACTORY_PAT`, so expect that first push to fire the caller and fail one run. Nothing to fix: it clears itself once the steps below are done.

3. **Run the onboarding script.** `scripts/onboard.sh owner/repo`, for example `scripts/onboard.sh chizhangucb/factory-fixture`. It creates the label vocabulary, allows auto-merge on the repo, and puts a `factory` ruleset on the default branch: PR required, squash only, and `factory/verdict`, `factory/red-green`, `factory/test-integrity` plus the target's own checks, all required on a head up to date with main. The own checks are discovered: the script reads what GitHub says actually posted on the last five commits of the default branch, and requires a name only if it posted on every one of them. A name on some but not all is printed as a possible path-filtered check and left out, because requiring one would leave a PR that touches none of its paths waiting forever on a check that never posts. Name checks yourself, `scripts/onboard.sh owner/repo check lint`, when discovery gets it wrong: that turns discovery off and requires exactly what you listed. Discover nothing and name nothing and the script warns that the ruleset will gate on the factory's checks alone, so a PR that breaks the target's build can still merge. Re-run the script to update the ruleset.

   The script reads whether the repo carries a caller yet (step 1); it needs no flag for this. Run it on a repo with no caller -- before step 1 lands, or on this repo itself, which carries none -- and the factory's three checks drop out, since no caller means they are never posted: the ruleset requires only the own checks you listed. Name none either, and it warns that the ruleset requires nothing at all.

4. **Check the caller's permissions.** It must grant `statuses: write`, `checks: read` and `actions: read`. They are in `templates/factory.yml`, so a fresh copy has them; a target onboarded before those lines existed needs them added.

5. **Let this repo serve its workflows.** Settings, Actions, General, Access. A private factory repo will not serve them otherwise.

6. **Add a heartbeat.** The caller's `schedule` is the fallback, not the heartbeat: on one private target over 21 and a half hours it fired 6 times against about 129 expected. Send `gh api repos/<owner>/<repo>/dispatches -f event_type=factory-sweep` every 10 minutes, from anything that is not a GitHub cron, with a token that has contents write on the target and nothing else. One sender covers any number of targets. Without it the dispatcher and the reconciler run only as often as GitHub's cron fires, so a stranded run, a PR whose auto-merge failed, and a ticket whose blocker closed without firing an event on the target all wait.

Then label a ticket `ready-for-agent` and the pipeline above runs. To hold a ready ticket back, add `hold`: the dispatcher never dispatches a ticket carrying it, and removing it releases the ticket on the next sweep (`docs/agents/triage-labels.md`). Labeling `agent:implement` by hand still works. `docs/pipeline.md` has the reasoning behind each step, what `FACTORY_PAT` cannot do, and the re-copy a target onboarded before #61 needs.

## Pause the factory on a target

One repository variable on the target, and its value is the reason:

```
gh variable set FACTORY_PAUSED --repo owner/repo --body "runaway sweep, see #123"
gh variable delete FACTORY_PAUSED --repo owner/repo   # resume
```

- **Paused**: dispatch (and the reconciler with it), the implementer, the reviewer, implement-pr, update-branch. Everything that starts work or moves it along.
- **Still running**: `merge-gate` and `audit`. A PR opened while paused still gets `factory/red-green` and `factory/test-integrity`, so a pause never quietly takes the merge gate off a human's PR. `audit` still runs a model on merged factory PRs and still opens a revert PR on a miss, which is wanted.
- **Visible**: the variable sits in Settings, Secrets and variables, Actions, with the reason as its value, and every factory run while it is set carries a `paused` job saying the same thing.
- **No event is queued**, because a gated job is skipped rather than held, so nothing fires retroactively when you lift it.

In an incident, **pause first, then cancel**. A pause does not stop a run already in flight, and cancelling one before the pause is on buys a replacement within a minute or two: the retry handler reads a cancel as the implementer's own failure and re-labels the ticket. With the pause on, that re-label lands and starts nothing.

**Before you resume, fix what caused the pause.** No event is replayed, but the repo's state is still there, so the first sweep after a resume dispatches every ticket that is still `ready-for-agent` and repairs every stranding the reconciler finds. A resume with the cause still in place restarts it. `docs/pipeline.md` has the rest, including what a pause does not do.

Do not reach for `gh workflow disable factory.yml` instead. That file is the caller for every factory role, so disabling it takes `merge-gate` and `audit` down too, and their checks do not fail on a PR opened while it is off, they never appear.

The gate lives in the caller, so it drifts like the trigger set: a target that has not re-copied `templates/factory.yml` since this landed has no gate, and setting the variable there does nothing at all. Re-copy the caller.

## Where to read more

- `docs/pipeline.md`: the reference. Every caller input, every pipeline stage, the engine, and the layout of the tree.
- `CONTEXT.md`: the glossary. `docs/adr/`: the decisions. The spec is issue #9.
- `docs/provenance/sandcastle.md`: the essay, why the engine was vendored rather than forked. `docs/provenance/sandcastle-files.md`: the reference, what is sandcastle's and what is ours file by file, for anyone changing a vendored file or checking a count.
- `docs/research/`: the dated snapshots the ADRs rest on, never updated.
- `docs/agents/`: the rules binding an agent working in this repo.
