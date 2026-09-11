#!/usr/bin/env bash
# Onboard a target repo: labels, auto-merge, and a `factory` ruleset on the default branch. Idempotent.
#   scripts/onboard.sh owner/repo [own-check ...]
# An own check is one the target's CI posts, required beside the factory's three. Name none and
# they are discovered: required only if posted on each of the last 5 default-branch commits,
# because a path-filtered check would leave a PR outside its paths waiting on it forever.
set -euo pipefail
check_sample=5
repo="${1:?usage: onboard.sh owner/repo [own-check ...]}"
shift

# `--force` rewrites a same-named label the target already has: check `hold` is not already theirs.
# The five triage roles' descriptions are docs/agents/triage-labels.md's Meaning column.
label() { gh label create "$1" --repo "$repo" --color "$2" --description "$3" --force >/dev/null && echo "label $1"; }
label "ready-for-agent"   "0e8a16" "Fully specified, ready for an AFK agent"
label "hold"              "d4c5f9" "Factory: never dispatched while this is set"
label "ready-for-human"   "c2e0c6" "Requires human implementation"
label "needs-triage"      "ededed" "Maintainer needs to evaluate this issue"
label "needs-info"        "bfd4f2" "Waiting on reporter for more information"
label "wontfix"           "ffffff" "Will not be actioned"
label "bug"               "d73a4a" "Something is broken"
label "enhancement"       "a2eeef" "New feature or improvement"
label "agent:implement"   "1d76db" "Factory: run the implementer on this ticket"
label "agent:in-progress" "fbca04" "Factory: a run is active"
label "agent:review"      "5319e7" "Factory: run the reviewer on this PR"
label "agent:blocked"     "b60205" "Factory: last run failed, see the comment"
label "needs-human"       "d93f0b" "Factory: escalated, a human must read this"
label "factory:retry-1"   "c5def5" "Factory: retries used on this ticket"
label "wayfinder:map"       "006b75" "Wayfinder: the map a chart's decision tickets hang off"
label "wayfinder:research"  "006b75" "Wayfinder: AFK, read sources for a fact a decision waits on"
label "wayfinder:prototype" "006b75" "Wayfinder: with a human, a rough artifact to react to"
label "wayfinder:grilling"  "006b75" "Wayfinder: with a human, conversation to settle a decision"
label "wayfinder:task"      "006b75" "Wayfinder: manual work a decision is blocked on, AFK where it can be"

# Printed before the ruleset write and again after it, so it cannot scroll past.
warn_no_own_check() {
  {
    echo "############################################################"
    if [ "$has_caller" = "true" ]; then
      echo "## WARNING: no own check for $repo: none discovered, none named."
      echo "## The factory ruleset gates on the factory's checks alone:"
      echo "##   factory/verdict, factory/red-green, factory/test-integrity."
      echo "## The target's own CI is not required, so a PR that breaks the"
      echo "## target's build still merges."
    else
      echo "## WARNING: no own check for $repo, and it carries no caller."
      echo "## The ruleset requires nothing at all: no factory checks, since"
      echo "## no caller posts them, and no own check either. A PR merges"
      echo "## with nothing having run on it."
    fi
    if [ "$discovery_ran" = "true" ] && [ "$sampled_commits" -gt 0 ]; then
      echo "## Discovery read $sampled_commits recent commits of the default branch"
      echo "## and found no check posted on every one of them."
    elif [ "$discovery_ran" = "true" ]; then
      echo "## Discovery had nothing to read: no commits on the default"
      echo "## branch yet. Re-run once the target's CI has posted on some."
    fi
    echo "## Fix: name the checks the target's CI posts, which turns"
    echo "## discovery off and requires exactly what you list, e.g."
    echo "##   scripts/onboard.sh $repo check"
    echo "############################################################"
  } >&2
}

note_unused_defaults() {
  {
    echo "############################################################"
    echo "## NOTE: $repo may still carry GitHub's default labels that"
    echo "## nothing here uses. This script deletes nothing, ever."
    echo "## Check each is unused on $repo first: deleting a label strips"
    echo "## it from every issue carrying it, silently and with no way back."
    echo "## To drop the ones it has, by hand:"
    for unused in "documentation" "good first issue" "help wanted" "invalid" "question"; do
      echo "##   gh label delete \"$unused\" --repo $repo --yes"
    done
    echo "## Not in that list, and not to be deleted: bug, enhancement,"
    echo "## wontfix and duplicate. Those are triage vocabulary."
    echo "############################################################"
  } >&2
}

judged_path_template="$(dirname "${BASH_SOURCE[0]}")/../templates/agents-md-judged-path.md"
note_judged_path() {
  {
    echo "############################################################"
    echo "## NOTE: an agent opening a PR on $repo itself needs"
    echo "## the line below in the target's AGENTS.md (or CLAUDE.md),"
    echo "## as it stands, or that PR stays blocked. It is the whole of"
    echo "## templates/agents-md-judged-path.md:"
    cat "$judged_path_template" ||
      echo "## (could not read it here: take it from the factory repo)"
    echo "## Landing it is $repo's own PR: this script writes no"
    echo "## file there."
    echo "############################################################"
  } >&2
}

gh repo edit "$repo" --enable-auto-merge --delete-branch-on-merge >/dev/null
echo "repo: auto-merge allowed, branches deleted on merge"

default_branch=$(gh api "repos/$repo" --jq .default_branch)
if caller_error=$(gh api "repos/$repo/contents/.github/workflows/factory.yml" 2>&1 >/dev/null); then
  has_caller=true
elif [[ "$caller_error" == *"HTTP 404"* ]]; then
  has_caller=false
else
  echo "onboard.sh: could not tell whether $repo carries a caller: $caller_error" >&2
  exit 1
fi

sampled_commits=0
discovery_ran=false
discovered_required=""
discovered_partial=""
discover_own_checks() {
  local sha names runs statuses counted recent listing_error listing_error_file
  local listing_status=0
  local seen=""
  listing_error_file=$(mktemp)
  # Assigned, not looped over inline, so a failed listing aborts rather than reading as no history.
  recent=$(gh api "repos/$repo/commits?sha=$default_branch&per_page=$check_sample" --jq '.[].sha' 2>"$listing_error_file") ||
    listing_status=$?
  listing_error=$(cat "$listing_error_file")
  rm -f "$listing_error_file"
  if [ "$listing_status" -ne 0 ]; then
    if [[ "$listing_error" == *"HTTP 409"* && "$listing_error" == *"Git Repository is empty"* ]]; then
      recent=""
    else
      echo "onboard.sh: could not read $repo's recent commits: $listing_error" >&2
      exit 1
    fi
  fi
  while IFS= read -r sha; do
    # An empty listing still feeds the herestring one empty line.
    if [ -z "$sha" ]; then continue; fi
    sampled_commits=$((sampled_commits + 1))
    # Both report styles, since a ruleset context matches either; one assignment each so set -e sees a failure.
    runs=$(gh api "repos/$repo/commits/$sha/check-runs?per_page=100" --jq '.check_runs[].name')
    statuses=$(gh api "repos/$repo/commits/$sha/status?per_page=100" --jq '.statuses[].context')
    # factory/ checks are the caller's to require, never discovered. sort -u: a re-run posts a name twice.
    names=$(printf '%s\n%s\n' "$runs" "$statuses" | awk 'NF && $0 !~ /^factory\//' | sort -u)
    seen="$seen$names"$'\n'
  done <<<"$recent"
  [ "$sampled_commits" -gt 0 ] || return 0
  counted=$(printf '%s' "$seen" | awk 'NF' | sort | uniq -c)
  # An empty herestring is still one record to awk.
  if [ -z "$counted" ]; then return 0; fi
  discovered_required=$(awk -v n="$sampled_commits" '{ count = $1; sub(/^ *[0-9]+ /, ""); if (count + 0 == n) print }' <<<"$counted")
  discovered_partial=$(awk -v n="$sampled_commits" '{ count = $1; sub(/^ *[0-9]+ /, ""); if (count + 0 != n) print $0 " (posted on " count " of " n ")" }' <<<"$counted")
}
note_path_filtered() {
  {
    echo "############################################################"
    echo "## NOTE: these posted on some of the $sampled_commits sampled commits of"
    echo "## $default_branch, but not all, so they read as path-filtered"
    echo "## and are NOT required:"
    while IFS= read -r partial; do
      if [ -n "$partial" ]; then echo "##   $partial"; fi
    done <<<"$discovered_partial"
    echo "## Requiring one would leave a PR that touches none of its paths"
    echo "## waiting forever for a check that never posts."
    echo "## If one really does post on every PR, name it by hand:"
    echo "##   scripts/onboard.sh $repo <check> ..."
    echo "############################################################"
  } >&2
}
if [ "$#" -eq 0 ]; then
  discovery_ran=true
  discover_own_checks
  while IFS= read -r discovered; do
    if [ -n "$discovered" ]; then set -- "$@" "$discovered"; fi
  done <<<"$discovered_required"
  if [ "$#" -gt 0 ]; then
    echo "discovered on $sampled_commits recent commits of $default_branch: $*"
  fi
  if [ -n "$discovered_partial" ]; then note_path_filtered; fi
else
  echo "own checks named on the command line, discovery skipped: $*"
fi
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
own_checks=$(jq -r '[.[].context | select(. != "" and (startswith("factory/") | not))] | length' <<<"$checks")
# The admin role (actor_id 5) bypasses the ruleset, so a human can still push the caller workflow.
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
# Last, so the warning has the last word on screen.
if [ "$has_caller" = "true" ]; then note_judged_path; fi
note_unused_defaults
if [ "$own_checks" -eq 0 ]; then warn_no_own_check; fi
