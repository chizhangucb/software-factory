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

2. **Add the secrets.**
   - `FACTORY_PAT`, a fine-grained PAT, so pushes trigger the target's CI. It needs contents, issues, pull requests and workflows write.
   - One `CLAUDE_CODE_OAUTH_TOKEN_<n>` per subscription account, from `claude setup-token`. Adding an account later is adding one more secret. Optional: a `CLAUDE_ACCOUNT_<n>` variable naming each account for you. The factory never publishes it: not in the job log, the usage comment, an escalation comment, an attached log or an uploaded artifact, all of which are world-readable on a public target. Every one of those names the account by its `<n>` instead. The label appears only in `usage.json` on the runner.

   Step 1 lands the caller before this step adds `FACTORY_PAT`, so expect that first push to fire the caller and fail one run. Nothing to fix: it clears itself once the steps below are done.

3. **Run the onboarding script.** `scripts/onboard.sh owner/repo [own-check ...]`, for example `scripts/onboard.sh chizhangucb/factory-fixture check`. It creates the label vocabulary, allows auto-merge on the repo, and puts a `factory` ruleset on the default branch: PR required, squash only, and `factory/verdict`, `factory/red-green`, `factory/test-integrity` plus the own checks you listed, all required on a head up to date with main. Each own check is a job name the target's CI already posts, and naming them matters: with no own check the script warns that the ruleset will gate on the factory's checks alone, so a PR that breaks the target's build can still merge. Re-run the script to update the ruleset.

4. **Check the caller's permissions.** It must grant `statuses: write`, `checks: read` and `actions: read`. They are in `templates/factory.yml`, so a fresh copy has them; a target onboarded before those lines existed needs them added.

5. **Let this repo serve its workflows.** Settings, Actions, General, Access. A private factory repo will not serve them otherwise.

6. **Add a heartbeat.** The caller's `schedule` is the fallback, not the heartbeat: on one private target over 21 and a half hours it fired 6 times against about 129 expected. Send `gh api repos/<owner>/<repo>/dispatches -f event_type=factory-sweep` every 10 minutes, from anything that is not a GitHub cron, with a token that has contents write on the target and nothing else. One sender covers any number of targets. Without it the dispatcher and the reconciler run only as often as GitHub's cron fires, so a stranded run, a PR whose auto-merge failed, and a ticket whose blocker closed without firing an event on the target all wait.

Then label a ticket `ready-for-agent` and the pipeline above runs. Labeling `agent:implement` by hand still works. `docs/pipeline.md` has the reasoning behind each step, what `FACTORY_PAT` cannot do, and the re-copy a target onboarded before #61 needs.

## Where to read more

- `docs/pipeline.md`: the reference. Every caller input, every pipeline stage, the engine, and the layout of the tree.
- `CONTEXT.md`: the glossary. `docs/adr/`: the decisions. The spec is issue #9.
- `docs/provenance/sandcastle.md`: the essay, why the engine was vendored rather than forked. `docs/provenance/sandcastle-files.md`: the reference, what is sandcastle's and what is ours file by file, for anyone changing a vendored file or checking a count.
- `docs/research/`: the dated snapshots the ADRs rest on, never updated.
- `docs/agents/`: the rules binding an agent working in this repo.
