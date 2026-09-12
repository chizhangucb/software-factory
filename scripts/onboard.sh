#!/usr/bin/env bash
# Onboard a target repo: labels, auto-merge, and a `factory` ruleset on the default branch. Idempotent.
#   scripts/onboard.sh owner/repo [--no-own-checks] [--allow-drop] [own-check ...]
# An own check is a required context in the target's `factory` ruleset that does not start with
# `factory/`. Name none and a re-run keeps exactly the ones that ruleset already requires, so
# re-running to pick up a label never needs the list remembered. Nothing is read off the target's
# commits: the script guesses no check, ever. A first run with none named refuses unless
# --no-own-checks says the target genuinely has none, and any run that would drop an own check the
# ruleset requires refuses unless --allow-drop says to let it go.
set -euo pipefail
repo="${1:?usage: onboard.sh owner/repo [--no-own-checks] [--allow-drop] [own-check ...]}"
shift

no_own_checks=false
allow_drop=false
named=()
# A count of its own: bash 3.2, which is what macOS ships, reads an empty array as unset under
# `set -u`, so every array below is counted as it is filled and expanded with the `+` guard.
named_count=0
for argument in "$@"; do
  case "$argument" in
    --no-own-checks) no_own_checks=true ;;
    --allow-drop) allow_drop=true ;;
    # An empty argument names no check. Anything else beginning with `-` is a typo for a flag,
    # and requiring it as a context is the one reading that cannot be what was meant.
    "") ;;
    -*) echo "onboard.sh: unknown flag: $argument" >&2; exit 1 ;;
    *) named+=("$argument"); named_count=$((named_count + 1)) ;;
  esac
done

# Every refusal prints like this and exits before any write: no label, no repo edit, no ruleset.
refuse() {
  {
    echo "############################################################"
    echo "## REFUSED: $repo was not onboarded, and nothing was written."
    while IFS= read -r line; do echo "## $line"; done <<<"$1"
    echo "############################################################"
  } >&2
  exit 1
}

# Printed before the ruleset write and again after it, so it cannot scroll past.
warn_no_own_check() {
  {
    echo "############################################################"
    if [ "$has_caller" = "true" ]; then
      echo "## WARNING: no own check for $repo."
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
    echo "## Fix: name the checks the target's CI posts, which requires"
    echo "## exactly what you list, e.g."
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

# Reads first, every one of them, so a refusal below happens before anything is written.
default_branch=$(gh api "repos/$repo" --jq .default_branch)
if caller_error=$(gh api "repos/$repo/contents/.github/workflows/factory.yml" 2>&1 >/dev/null); then
  has_caller=true
elif [[ "$caller_error" == *"HTTP 404"* ]]; then
  has_caller=false
else
  echo "onboard.sh: could not tell whether $repo carries a caller: $caller_error" >&2
  exit 1
fi

existing=$(gh api "repos/$repo/rulesets" --jq '.[] | select(.name == "factory") | .id' | head -n1)
existing_own=()
existing_own_count=0
if [ -n "$existing" ]; then
  # Assigned, not looped over inline, so a failure is caught: a ruleset that exists and cannot be
  # read is a refusal, never an empty answer, or the read failure reads as "this target requires
  # nothing" and the write below takes its own checks off.
  ruleset_error_file=$(mktemp)
  ruleset_status=0
  contexts=$(gh api "repos/$repo/rulesets/$existing" \
    --jq '.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context' \
    2>"$ruleset_error_file") || ruleset_status=$?
  ruleset_error=$(cat "$ruleset_error_file")
  rm -f "$ruleset_error_file"
  if [ "$ruleset_status" -ne 0 ]; then
    refuse "The factory ruleset (id $existing) is there but could not be read:
  $ruleset_error
Its own checks are what a re-run keeps and what a drop is measured against,
so onboarding cannot tell what this write would take away."
  fi
  while IFS= read -r context; do
    # The factory's three are the caller's to require, never the target's own.
    case "$context" in "" | factory/*) continue ;; esac
    existing_own+=("$context"); existing_own_count=$((existing_own_count + 1))
  done <<<"$contexts"
fi

# Where the own checks come from: the command line, the flag, or the ruleset already there.
if [ "$named_count" -gt 0 ] && [ "$no_own_checks" = "true" ]; then
  refuse "--no-own-checks says $repo has no own check, and these were named anyway:
  ${named[*]}
Pass one or the other."
elif [ "$named_count" -gt 0 ]; then
  own=("${named[@]}")
  echo "own checks named on the command line: ${own[*]}"
elif [ "$no_own_checks" = "true" ]; then
  own=()
  echo "no own check, as --no-own-checks says"
elif [ -n "$existing" ]; then
  own=(${existing_own[@]+"${existing_own[@]}"})
  if [ "$existing_own_count" -gt 0 ]; then
    echo "own checks kept from the factory ruleset (id $existing): ${own[*]}"
  else
    echo "no own check to keep: the factory ruleset (id $existing) requires none"
  fi
else
  refuse "$repo has no factory ruleset yet and no own check was named, so there is
nothing to keep and nothing to require. Onboarding does not guess.
Two ways on:
  scripts/onboard.sh $repo <check> ...   name the checks its CI posts
  scripts/onboard.sh $repo --no-own-checks   it genuinely has none yet"
fi

# A write that takes an own check off the ruleset is the foot-gun, whatever put the list together.
dropped=()
dropped_count=0
for was_required in ${existing_own[@]+"${existing_own[@]}"}; do
  still_required=false
  for keeping in ${own[@]+"${own[@]}"}; do
    if [ "$keeping" = "$was_required" ]; then still_required=true; fi
  done
  if [ "$still_required" = "false" ]; then dropped+=("$was_required"); dropped_count=$((dropped_count + 1)); fi
done
if [ "$dropped_count" -gt 0 ] && [ "$allow_drop" = "false" ]; then
  refuse "This run would stop requiring own checks $repo's factory ruleset requires:
$(printf '  %s\n' "${dropped[@]}")
A PR that breaks one would then merge clean.
Name them alongside the rest, or pass --allow-drop if they really are to go."
fi

# `--force` rewrites a same-named label the target already has: check `hold` is not already theirs.
# The five triage roles' descriptions are docs/agents/triage-labels.md's Meaning column.
label() { gh label create "$1" --repo "$repo" --color "$2" --description "$3" --force >/dev/null && echo "label $1"; }
gh repo edit "$repo" --enable-auto-merge --delete-branch-on-merge >/dev/null
echo "repo: auto-merge allowed, branches deleted on merge"
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

build_checks() {
  jq -cn '[$ARGS.positional[] | select(. != "")]
    | reduce .[] as $c ([]; if index($c) then . else . + [$c] end)
    | map({context: .})' --args "$@"
}
if [ "$has_caller" = "true" ]; then
  checks=$(build_checks factory/verdict factory/red-green factory/test-integrity ${own[@]+"${own[@]}"})
else
  checks=$(build_checks ${own[@]+"${own[@]}"})
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
