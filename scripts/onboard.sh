#!/usr/bin/env bash
# Onboard a target repo: the triage and factory labels, auto-merge on the repo, and a
# ruleset on the default branch that requires a PR plus the factory's checks
# (up to date with main) before anything merges. Secrets and the caller
# workflow are the other two steps; see README.md. Idempotent.
#   scripts/onboard.sh owner/repo [own-check ...]
# Each extra argument is a status check the target's own CI already posts
# (the job name, e.g. `check`); it is required next to the factory's three.
# Give none and onboarding still runs, loudly: see warn_no_own_check.
set -euo pipefail
repo="${1:?usage: onboard.sh owner/repo [own-check ...]}"
shift

# ADR 0003 makes the merge gate three things: the target's own CI, red-green, and test-integrity,
# with the verdict on top. Onboard with no own check and the ruleset is missing the first of
# them, and silence about that is how a maintainer ends up trusting a merge gate that never runs
# their build. It is a warning and not a refusal because a target with no CI at all is real,
# and refusing it would need a flag to say so, which is a knob nobody asked for.
# With no caller the factory's three are never posted either, so the empty case is the
# opposite one: a ruleset requiring nothing at all, not just missing the target's own CI.
# Printed twice, before the ruleset write and after it, so it cannot scroll past. Reads
# $repo, $has_caller and $own_checks from the script, like every other line here.
warn_no_own_check() {
  {
    echo "############################################################"
    if [ "$has_caller" = "true" ]; then
      echo "## WARNING: no own check given for $repo."
      echo "## The factory ruleset gates on the factory's checks alone:"
      echo "##   factory/verdict, factory/red-green, factory/test-integrity."
      echo "## The target's own CI is not required, so a PR that breaks the"
      echo "## target's build still merges."
    else
      echo "## WARNING: no own check given for $repo, and it carries no caller."
      echo "## The ruleset requires nothing at all: no factory checks, since"
      echo "## no caller posts them, and no own check either. A PR merges"
      echo "## with nothing having run on it."
    fi
    echo "## Fix: re-run naming the checks the target's CI posts, e.g."
    echo "##   scripts/onboard.sh $repo check"
    echo "############################################################"
  } >&2
}
label() { gh label create "$1" --repo "$repo" --color "$2" --description "$3" --force >/dev/null && echo "label $1"; }
label "ready-for-agent"   "0e8a16" "Fully specified, ready for an AFK agent"
label "ready-for-human"   "c2e0c6" "Requires human implementation"
label "needs-triage"      "ededed" "Maintainer needs to evaluate this issue"
label "agent:implement"   "1d76db" "Factory: run the implementer on this ticket"
label "agent:in-progress" "fbca04" "Factory: a run is active"
label "agent:review"      "5319e7" "Factory: run the reviewer on this PR"
label "agent:blocked"     "b60205" "Factory: last run failed, see the comment"
label "needs-human"       "d93f0b" "Factory: escalated, a human must read this"
label "factory:retry-1"   "c5def5" "Factory: retries used on this ticket"

# Auto-merge is enabled per PR by the implementer; the repo must allow it. Merged branches go.
gh repo edit "$repo" --enable-auto-merge --delete-branch-on-merge >/dev/null
echo "repo: auto-merge allowed, branches deleted on merge"

# Ruleset "factory" on the default branch (ADR 0003, fallback amendment): a PR is required,
# every listed check must pass on a head that is up to date with the branch, no deletes or
# force pushes. Repository admins bypass, so a human can still push the caller workflow;
# auto-merge never bypasses, it waits for the checks. Create once, update on later runs.
default_branch=$(gh api "repos/$repo" --jq .default_branch)
# A caller is the one workflow file that posts the factory's three checks (CONTEXT.md).
# A repo without one never posts them, so requiring them there is a ruleset that can never
# be satisfied. The decision is read off the repo, not passed as a flag.
if gh api "repos/$repo/contents/.github/workflows/factory.yml" >/dev/null 2>&1; then
  has_caller=true
else
  has_caller=false
fi
# Empty arguments name no check, and a name handed back twice is still one check; both would
# otherwise reach GitHub as a bogus context in the ruleset, so drop them here. First mention
# wins, which keeps the factory's three at the front, when there is a caller to post them.
build_checks() {
  jq -cn '[$ARGS.positional[] | select(. != "")]
    | reduce .[] as $c ([]; if index($c) then . else . + [$c] end)
    | map({context: .})' --args "$@"
}
if [ "$has_caller" = "true" ]; then
  checks=$(build_checks factory/verdict factory/red-green factory/test-integrity "$@")
else
  checks=$(build_checks "$@")
fi
# Counted off the ruleset rather than off the argument list, because the thing worth warning
# about is a ruleset with nothing in it but the factory's checks. A `factory/` name handed
# back as an own check is one of ours, and an empty argument names no check at all.
own_checks=$(jq -r '[.[].context | select(. != "" and (startswith("factory/") | not))] | length' <<<"$checks")
payload=$(jq -cn --arg branch "$default_branch" --argjson checks "$checks" '{
  name: "factory",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["refs/heads/\($branch)"], exclude: [] } },
  bypass_actors: [ { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" } ],
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "pull_request", parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: false,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
        require_extra_approval_for_unattributed_changes: false,
        allowed_merge_methods: ["squash"] } },
    { type: "required_status_checks", parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: false,
        required_status_checks: $checks } }
  ]
}')
if [ "$own_checks" -eq 0 ]; then warn_no_own_check; fi
existing=$(gh api "repos/$repo/rulesets" --jq '.[] | select(.name == "factory") | .id' | head -n1)
if [ -n "$existing" ]; then
  gh api --method PUT "repos/$repo/rulesets/$existing" --input - <<<"$payload" >/dev/null
  echo "ruleset factory updated (id $existing)"
else
  id=$(gh api --method POST "repos/$repo/rulesets" --input - <<<"$payload" --jq .id)
  echo "ruleset factory created (id $id)"
fi
echo "required on $default_branch: $(jq -r '[.[].context] | join(", ")' <<<"$checks")"
if [ "$own_checks" -eq 0 ]; then warn_no_own_check; fi
