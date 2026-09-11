#!/usr/bin/env bash
# Onboard a target repo: the triage and factory labels, auto-merge on the repo, and a
# ruleset on the default branch that requires a PR plus the factory's checks
# (up to date with main) before anything merges. Secrets and the caller
# workflow are the other two steps; see README.md. Idempotent. It ends by
# printing the line a target needs in its AGENTS.md; see note_judged_path.
#   scripts/onboard.sh owner/repo [own-check ...]
# Each extra argument is a status check the target's own CI already posts
# (the job name, e.g. `check`); it is required next to the factory's three.
# Give none and the script discovers them instead, off what GitHub reports as having
# posted on the last 5 commits of the default branch. Five is the sample size, and the
# reason is the intersection rule below: a name is required only if it posted on every
# sampled commit, so the sample has to be big enough that a path-filtered check misses at
# least one of them. One commit cannot tell an always-on check from a path-filtered one
# that happened to run; five is enough that a docs-only or one-directory commit is usually
# among them, and short enough that a job added a week ago still posted on all five.
# Larger and a recently added check reads as path-filtered, because the oldest commits in
# the sample predate it, and it silently stops being required. Smaller and a path-filtered
# check reads as always-on, which is the failure this whole thing exists to avoid. Cost is
# two API calls per sampled commit, check runs and commit statuses, plus one for the listing.
# Discover nothing, or name nothing, and onboarding still runs, loudly: see warn_no_own_check.
set -euo pipefail
# The sample size the header explains. onboard.test.ts reads both and fails on drift.
check_sample=5
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
    # Said only when discovery actually ran, and off what it actually sampled. A run that
    # named checks on the command line turned discovery off, and a brand new target has no
    # commits to read: telling either of them that five commits were read and came back
    # empty is a sentence about a thing that never happened, in the one block a maintainer
    # is meant to act on.
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
label() { gh label create "$1" --repo "$repo" --color "$2" --description "$3" --force >/dev/null && echo "label $1"; }
label "ready-for-agent"   "0e8a16" "Fully specified, ready for an AFK agent"
# The hold, and where its meaning is delivered. A triager meets this label in the label
# picker and nowhere else, so the description has to carry the whole rule; prose in the
# target's own docs would be a copy this repo cannot see or keep in step. `--force` in
# label() means a re-run rewrites it, so an existing target gets it by re-running the
# script; that run also rewrites the ruleset, off discovery unless checks are named. `hold` is an
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
# turns on; the map is the container and has no such answer. The strings are the skill's and
# not ours, which is why `wayfinder:task` keeps a word CONTEXT.md otherwise avoids: renaming
# it here would just mean `gh issue create --label wayfinder:task` failing on every chart.
label "wayfinder:map"       "006b75" "Wayfinder: the map a chart's decision tickets hang off"
label "wayfinder:research"  "006b75" "Wayfinder: AFK, read sources for a fact a decision waits on"
label "wayfinder:prototype" "006b75" "Wayfinder: with a human, a rough artifact to react to"
label "wayfinder:grilling"  "006b75" "Wayfinder: with a human, conversation to settle a decision"
label "wayfinder:task"      "006b75" "Wayfinder: manual work a decision is blocked on, AFK where it can be"

# GitHub puts nine labels on every new repo, and four of them are in use: bug, enhancement
# and wontfix are roles the triage skill hands out, so they are asserted above, and
# duplicate is the answer a triager reaches for on a repeat report. That last one is
# created by nothing here, because no skill names it and this script only asserts what the
# vocabulary depends on; it is left alone rather than offered up, which is the difference
# between not creating a label and telling somebody to delete one.
# The other five are noise in a picker this script has just filled, and nothing in the
# factory or in the triage vocabulary reads any of them.
# Printed and never deleted: deleting a label strips it from every issue carrying it,
# silently and with no way back, and a script that does that to somebody's repo is a
# different risk class from one that only adds. The whole gain here is a legible picker,
# which a command a human reads before running buys just as well.
# "Unused" here is a claim about the factory and the triage vocabulary, and nothing else:
# the note is printed unconditionally rather than read off the repo, so it cannot know that
# a target labels its own docs issues `documentation`. Hence the line telling the reader to
# check before pasting; that check is the whole reason this prints instead of deleting.
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
# The one line every target needs for its other producers (#181): anything but the factory that
# opens a PR on the target, an interactive session or a cloud agent, has to put `Closes #N` in
# the body, `agent:review` on the PR and auto-merge on it, or the PR sits blocked on
# factory/verdict for good, and it should do all three without being asked. So the line goes in
# the target's AGENTS.md, which every agent working there reads. This script writes no file in
# the target: landing the line is the target's own PR, so it is printed, not written.
# Read off templates/ rather than spelled out here, so what this shows is the copy every target
# takes, byte for byte, with no second copy in this file to drift from it. Printed bare rather
# than behind `## `, so it pastes into AGENTS.md as it stands.
# A NOTE and not a WARNING: a producer nobody told gets a PR that sits blocked, which is where
# it was before, so nothing is at risk. And only on a repo with a caller: without one nothing
# answers `agent:review` and no factory check is required, so the line's last sentence, the
# factory judges it and merges it, would be false there.
# Never fatal, for the same reason note_unused_defaults is not: the ruleset is written by now
# and the warning prints after this, so a template that cannot be read costs this note alone.
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
# Discovery. Onboarding a repo you were handed an hour ago should not need its job names, and
# GitHub already knows them: it reports what actually posted on a commit, which is stronger
# evidence than anything typed by hand. So with no names on the command line, sample the last
# $check_sample commits of the default branch and read the check runs off each.
# The intersection, and not the union, is what gets required. A check with a path filter does
# not post on every commit, and requiring one leaves a PR that touches none of those paths
# waiting forever on a check that will never arrive, with auto-merge waiting with it. That is
# the worst thing this script can do to a target, and it is silent. A name on some commits but
# not all is therefore reported and not required; a maintainer who knows better names it on the
# command line. The other direction, a check missed and not required, is the warning case:
# loud, and a re-run fixes it.
# The factory's own three are dropped here rather than discovered: whether they are required is
# read off the caller above, and a target that carried a caller and then lost it would
# otherwise have them rediscovered out of history and required with nothing left to post them.
sampled_commits=0
# Whether discovery ran at all, as opposed to having run and found nothing. warn_no_own_check
# reads it: checks named on the command line turn discovery off, and the warning must not
# then describe a read that never happened.
discovery_ran=false
discovered_required=""
discovered_partial=""
discover_own_checks() {
  local sha names runs statuses counted recent listing_error listing_error_file
  local listing_status=0
  local seen=""
  # Held in a variable rather than looped over straight out of `$(...)`, because a command
  # substitution in a `for` list has its exit status thrown away: a rate limit would arrive as
  # an empty list and read as a target whose CI has posted nothing, which is a wrong warning
  # and a ruleset written off an answer nobody got.
  # And caught by hand rather than left to set -e, the way the caller check above is, because
  # one failure here is an answer. GitHub lists a repo with no commits yet as a 409, "Git
  # Repository is empty", where the caller check gets a 404 for the same repo and reads it as
  # no caller. Before discovery such a repo onboarded with the loud warning, and it still does:
  # the 409 is zero sampled commits. Matched on status and message both, narrowly, because the
  # point of the strictness is that a rate limit must never read as an empty history; anything
  # else is re-raised with gh's own words. stderr goes to a file because stdout carries the
  # shas, and gh prints its error body there on a failure.
  listing_error_file=$(mktemp)
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
    # An empty listing still feeds a herestring one empty line, and a sha of "" would count as
    # a commit that posted nothing and take the intersection down to nothing with it.
    if [ -z "$sha" ]; then continue; fi
    sampled_commits=$((sampled_commits + 1))
    # Both report styles, because a ruleset context matches either and a target's CI may use
    # either: GitHub Actions posts check runs, while external CI (CircleCI, Jenkins) and the
    # factory's own three post commit statuses (ADR 0003: "Commit statuses are always posted
    # with GITHUB_TOKEN"). Reading one style only would send half the targets to the "your CI
    # posted nothing" warning with their CI sitting right there in the API.
    # One assignment per endpoint, and not both inside one `{ ...; ...; } | ...`, for the same
    # reason the listing above is held in a variable: a group's exit status is its last
    # command's, so a check-runs call that failed on a rate limit would be swallowed whole by
    # the status call succeeding after it, and the commit would read as having posted only its
    # statuses. That is the intersection silently losing a real check. A bare assignment fails
    # loudly under set -e instead.
    runs=$(gh api "repos/$repo/commits/$sha/check-runs?per_page=100" --jq '.check_runs[].name')
    statuses=$(gh api "repos/$repo/commits/$sha/status?per_page=100" --jq '.statuses[].context')
    # `sort -u` because a re-run posts a second check run under the same name, and one name
    # posted twice on one commit must not count as two commits. awk and not grep -v, which
    # exits 1 on a commit whose only checks are the factory's and would take set -e with it.
    names=$(printf '%s\n%s\n' "$runs" "$statuses" | awk 'NF && $0 !~ /^factory\//' | sort -u)
    seen="$seen$names"$'\n'
  done <<<"$recent"
  [ "$sampled_commits" -gt 0 ] || return 0
  # One line per name, "<commits it posted on> <name>". Line-based throughout, because a job
  # name is routinely several words: `test (20.x)`, `build / lint`.
  counted=$(printf '%s' "$seen" | awk 'NF' | sort | uniq -c)
  # Nothing discovered is not one nameless check. A herestring hands awk one empty record even
  # for an empty string, which printed a note block whose single entry was "(posted on  of 5)":
  # a warning about path filters on the run that found no checks at all.
  if [ -z "$counted" ]; then return 0; fi
  discovered_required=$(awk -v n="$sampled_commits" '{ count = $1; sub(/^ *[0-9]+ /, ""); if (count + 0 == n) print }' <<<"$counted")
  discovered_partial=$(awk -v n="$sampled_commits" '{ count = $1; sub(/^ *[0-9]+ /, ""); if (count + 0 != n) print $0 " (posted on " count " of " n ")" }' <<<"$counted")
}
# What discovery saw but will not require, and the one way to override it. Printed to stderr
# with the rest of the advice, because it is a thing to decide about rather than a thing the
# run did. Named, because a maintainer who knows the check posts on every PR that matters is
# the only one who can say so, and the positional arguments are how they say it.
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
# Last, so it is on screen when the run ends rather than buried under the ruleset output.
# The instruction first, beside the required checks, since it is what a PR the factory did not
# write needs to meet them; then the unused labels; then the warning, which is the most
# important of the three and gets the last word.
if [ "$has_caller" = "true" ]; then note_judged_path; fi
note_unused_defaults
if [ "$own_checks" -eq 0 ]; then warn_no_own_check; fi
