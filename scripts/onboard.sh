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
# The hold, and where its meaning is delivered. A triager meets this label in the label
# picker and nowhere else, so the description has to carry the whole rule; prose in the
# target's own docs would be a copy this repo cannot see or keep in step. `--force` in
# label() means a re-run rewrites it, so an existing target gets it by re-running the
# script with its own checks named again; that run also rewrites the ruleset. `hold` is an
# ordinary word, so check whether the target already uses the label for something of its
# own before onboarding: --force rewrites it in place and every issue carrying it is held.
# `Factory:` here says who reads the label, not who writes it: the label is a human's to
# add and remove, like `ready-for-agent`, and the prefix is what tells a triager in the
# picker that this one is addressed to the dispatcher rather than to another human.
label "hold"              "d4c5f9" "Factory: never dispatched while this is set"
label "ready-for-human"   "c2e0c6" "Requires human implementation"
label "needs-triage"      "ededed" "Maintainer needs to evaluate this issue"
# The other two triage roles. Nothing created them before this: `setup-matt-pocock-skills`
# writes the role-to-label mapping into docs/agents/triage-labels.md and never runs
# `gh label create` (mattpocock/skills#616), so every target made them by hand or did
# without. `gh issue create --label <missing>` fails outright rather than creating the
# label, so "did without" means a triage pass that cannot record its own answer.
# The descriptions are the Meaning column of that page, word for word: it is the one place
# the five roles are written down, and a skill reading it and a triager reading the picker
# should be reading the same sentence. onboard.test.ts parses the page and fails on drift.
label "needs-info"        "bfd4f2" "Waiting on reporter for more information"
label "wontfix"           "ffffff" "Will not be actioned"
# The two category roles the triage skill hands out, next to the five state roles above.
# Asserted rather than assumed: they exist on most targets only because GitHub creates them
# on a new repo, and a repo made from a template or tidied by hand has neither. The colours
# are GitHub's own, so a target that already has them sees no change in the picker; the
# descriptions are the skill's wording, which does change GitHub's ("Something isn't
# working", "New feature or request"). That rewrite is the point: one sentence per role
# across every target beats three wordings that mean the same thing.
label "bug"               "d73a4a" "Something is broken"
label "enhancement"       "a2eeef" "New feature or improvement"
label "agent:implement"   "1d76db" "Factory: run the implementer on this ticket"
label "agent:in-progress" "fbca04" "Factory: a run is active"
label "agent:review"      "5319e7" "Factory: run the reviewer on this PR"
label "agent:blocked"     "b60205" "Factory: last run failed, see the comment"
label "needs-human"       "d93f0b" "Factory: escalated, a human must read this"
label "factory:retry-1"   "c5def5" "Factory: retries used on this ticket"
# The wayfinder set: one map issue and the four types its child tickets carry. Same story as
# the triage roles, the skill names the strings and creates none of them, and here a missing
# label bites on the first ticket of a chart, because `gh issue create --label` refuses a
# label that does not exist. One colour for all five: the prefix already separates them in
# the picker, and a shared shade is what says they belong to one map. `Wayfinder:` reads
# like `Factory:` above, naming who the label is addressed to. Each ticket type says whether
# it is worked with a human (HITL) or driven alone (AFK), which is the distinction the skill
# turns on; the map is the container and has no such answer.
label "wayfinder:map"       "006b75" "Wayfinder: the map a chart's decision tickets hang off"
label "wayfinder:research"  "006b75" "Wayfinder: AFK, read sources for a fact a decision waits on"
label "wayfinder:prototype" "006b75" "Wayfinder: with a human, a rough artifact to react to"
label "wayfinder:grilling"  "006b75" "Wayfinder: with a human, conversation to settle a decision"
label "wayfinder:task"      "006b75" "Wayfinder: manual work a decision is blocked on, AFK where it can be"

# GitHub puts nine labels on every new repo, and four of them are vocabulary: bug and
# enhancement are the triage categories, wontfix is one of the five triage roles, and
# duplicate is a real triage answer. Those four stay, and three of them are asserted above.
# The other five are noise in a picker this script has just filled, and nothing in the
# factory or in the triage vocabulary reads any of them.
# Printed and never deleted: deleting a label strips it from every issue carrying it,
# silently and with no way back, and a script that does that to somebody's repo is a
# different risk class from one that only adds. The whole gain here is a legible picker,
# which a command a human reads before running buys just as well.
# One command per label, so a target that already dropped some of them can paste the rest,
# and unconditional rather than read back off the repo: a label listing is one more call
# that can fail, and under set -e a cosmetic note would then take the whole onboarding down.
# The names print quoted, because `gh label delete good first issue` is three arguments and
# an error, and a command a maintainer has to repair first is one they will not run.
note_unused_defaults() {
  {
    echo "############################################################"
    echo "## NOTE: $repo may still carry GitHub's default labels that"
    echo "## nothing here uses. This script deletes nothing, ever."
    echo "## To drop the ones it has, by hand:"
    for unused in "documentation" "good first issue" "help wanted" "invalid" "question"; do
      echo "##   gh label delete \"$unused\" --repo $repo --yes"
    done
    echo "## Not in that list, and not to be deleted: bug, enhancement,"
    echo "## wontfix and duplicate. Those are triage vocabulary."
    echo "############################################################"
  } >&2
}
note_unused_defaults

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
# A 404 confirms the file is absent; anything else -- a rate limit, a token missing scope,
# a network blip -- is not an answer to "does it have a caller" and must not be read as one.
# Every other gh api call in this script fails loudly through set -e; silencing this one's
# stderr to make the 404 quiet would silence every other failure too, so the failure is
# caught and re-raised by hand instead.
if caller_error=$(gh api "repos/$repo/contents/.github/workflows/factory.yml" 2>&1 >/dev/null); then
  has_caller=true
elif [[ "$caller_error" == *"HTTP 404"* ]]; then
  has_caller=false
else
  echo "onboard.sh: could not tell whether $repo carries a caller: $caller_error" >&2
  exit 1
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
