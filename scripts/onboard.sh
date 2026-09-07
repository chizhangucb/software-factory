#!/usr/bin/env bash
# Onboard a target repo: the factory's labels, auto-merge on the repo, and a
# ruleset on the default branch that requires a PR plus the factory's checks
# (up to date with main) before anything merges. Secrets and the caller
# workflow are the other two steps; see README.md. Idempotent.
#   scripts/onboard.sh owner/repo [own-check ...]
# Each extra argument is a status check the target's own CI already posts
# (the job name, e.g. `check`); it is required next to the factory's three.
set -euo pipefail
repo="${1:?usage: onboard.sh owner/repo [own-check ...]}"
shift
label() { gh label create "$1" --repo "$repo" --color "$2" --description "$3" --force >/dev/null && echo "label $1"; }
label "agent:implement"   "1d76db" "Factory: run the implementer on this ticket"
label "agent:in-progress" "fbca04" "Factory: a run is active"
label "agent:review"      "5319e7" "Factory: run the reviewer on this PR"
label "agent:blocked"     "b60205" "Factory: last run failed, see the comment"
label "needs-human"       "d93f0b" "Factory: escalated, a human must read this"

# Auto-merge is enabled per PR by the implementer; the repo must allow it. Merged branches go.
gh repo edit "$repo" --enable-auto-merge --delete-branch-on-merge >/dev/null
echo "repo: auto-merge allowed, branches deleted on merge"

# Ruleset "factory" on the default branch (ADR 0003, fallback amendment): a PR is required,
# every listed check must pass on a head that is up to date with the branch, no deletes or
# force pushes. Repository admins bypass, so a human can still push the caller workflow;
# auto-merge never bypasses, it waits for the checks. Create once, update on later runs.
default_branch=$(gh api "repos/$repo" --jq .default_branch)
checks=$(jq -cn '[$ARGS.positional[] | {context: .}]' --args factory/verdict factory/red-green factory/test-integrity "$@")
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
        allowed_merge_methods: ["squash"] } },
    { type: "required_status_checks", parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: false,
        required_status_checks: $checks } }
  ]
}')
existing=$(gh api "repos/$repo/rulesets" --jq '.[] | select(.name == "factory") | .id' | head -n1)
if [ -n "$existing" ]; then
  gh api --method PUT "repos/$repo/rulesets/$existing" --input - <<<"$payload" >/dev/null
  echo "ruleset factory updated (id $existing)"
else
  id=$(gh api --method POST "repos/$repo/rulesets" --input - <<<"$payload" --jq .id)
  echo "ruleset factory created (id $id)"
fi
echo "required on $default_branch: $(jq -r '[.[].context] | join(", ")' <<<"$checks")"
