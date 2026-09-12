#!/usr/bin/env bash
# Waive the factory's checks on one target, or put them back (#244).
#   scripts/waive-factory-checks.sh owner/repo on "<reason>"
#   scripts/waive-factory-checks.sh owner/repo off
# A waiver is a human's declaration that the factory cannot run, so its checks are not
# required on that target and it keeps merging on its own CI. Run it as a human: the
# factory's own PAT cannot write repo variables, and nothing in the factory calls this.
# `on` sets FACTORY_CHECKS_WAIVED to the reason, then takes the factory's three contexts
# out of the target's `factory` ruleset. That order is the interface: a failure between
# the two leaves a waiver visible and not yet in effect, never one in effect and invisible.
# `off` reverses it, ruleset first, so a half-failure leaves the target gated with the nag
# still up. The target's own check names are untouched either way, and nothing closes a
# waiver automatically: the heartbeat names an open one every run until a human runs `off`.
set -euo pipefail
repo="${1:?usage: waive-factory-checks.sh owner/repo on \"<reason>\" | off}"
mode="${2:-}"
reason="${3:-}"

variable="FACTORY_CHECKS_WAIVED"
factory_checks=(factory/verdict factory/red-green factory/test-integrity)

# Every refusal prints like this and exits before any write.
refuse() {
  {
    echo "############################################################"
    echo "## REFUSED: nothing was written to $repo."
    while IFS= read -r line; do echo "## $line"; done <<<"$1"
    echo "############################################################"
  } >&2
  exit 1
}

case "$mode" in
  on | off) ;;
  *) refuse "the mode is on or off, and \"$mode\" is neither:
  scripts/waive-factory-checks.sh $repo on \"<reason>\"
  scripts/waive-factory-checks.sh $repo off" ;;
esac

# A waiver with no reason is the one a maintainer cannot act on months later, and the
# reason is the variable's whole value, so there is nothing to write without it.
if [ "$mode" = "on" ] && [ -z "${reason// /}" ]; then
  refuse "a waiver needs a reason: it is what you will read months from now, and
it is the variable's value.
  scripts/waive-factory-checks.sh $repo on \"factory PAT expired, see #244\""
fi

# Reads first, all of them, so a refusal happens before anything is written.
# A GET, so reading a target's waiver cannot start a job on it. Unset is a 404.
open_reason=""
if value=$(gh api "repos/$repo/actions/variables/$variable" --jq .value 2>/dev/null); then
  open_reason="${value%$'\n'}"
fi

if [ "$mode" = "on" ] && [ -n "$open_reason" ]; then
  # Not destructive, and not a refusal either: the waiver asked for is already open.
  # Overwriting would replace the reason a maintainer wrote with a fresher, vaguer one.
  echo "$repo is already waived: $open_reason"
  echo "Nothing written. To change the reason, run off and then on again."
  exit 0
fi

# `includes_parents=false`, as onboard.sh reads it: an org ruleset named `factory` would
# otherwise read as this target's own and the write below would go to an id it does not own.
ruleset_id=$(gh api "repos/$repo/rulesets?includes_parents=false" --jq '.[] | select(.name == "factory") | .id')
ruleset_id=${ruleset_id%%$'\n'*}
if [ -z "$ruleset_id" ]; then
  refuse "$repo has no factory ruleset, so there is nothing to waive or restore.
Onboard it first: scripts/onboard.sh $repo <check> ..."
fi
ruleset=$(gh api "repos/$repo/rulesets/$ruleset_id")

# The ruleset goes back whole, with only the contexts changed: every other rule, the
# bypass actors and the conditions are the target's and none of this script's business.
# `on` removes exactly the factory's three; `off` appends the ones not already there, so
# the target's own checks keep their place and a re-run adds no duplicate.
rewrite() {
  jq -c --args --arg mode "$1" '
    ($ARGS.positional) as $factory
    | def contexts: [.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context];
      . as $r
    | (if $mode == "on" then [$r | contexts | .[] | select(. as $c | $factory | index($c) == null)]
       else ($r | contexts) + [$factory[] | select(. as $c | ($r | contexts) | index($c) == null)] end) as $wanted
    | { name, target, enforcement, conditions, bypass_actors,
        rules: [ .rules[] | if .type == "required_status_checks"
                 then .parameters.required_status_checks = [$wanted[] | {context: .}] else . end ] }' \
    <<<"$ruleset" -- "${factory_checks[@]}"
}

if [ "$mode" = "on" ]; then
  # The variable first: a failure after it leaves a nag with nothing waived, which is the
  # safe half. The other order leaves a target ungated with nothing saying so.
  gh variable set "$variable" --repo "$repo" --body "$reason" >/dev/null
  echo "$variable set on $repo: $reason"
  if ! rewrite on | gh api --method PUT "repos/$repo/rulesets/$ruleset_id" --input - >/dev/null; then
    {
      echo "############################################################"
      echo "## HALF DONE: $variable is set on $repo, and the factory's"
      echo "## checks are still required there: the ruleset write failed."
      echo "## The target is still gated, which is the safe half."
      echo "## Re-run: scripts/waive-factory-checks.sh $repo on \"$reason\""
      echo "## (it will say the waiver is already open; run off first)"
      echo "############################################################"
    } >&2
    exit 1
  fi
  echo "factory checks removed from $repo's factory ruleset (id $ruleset_id)"
else
  # The ruleset first, for the mirrored reason: a failure after it leaves the target
  # gated and the nag still up, rather than gated with nobody reminded to finish.
  rewrite off | gh api --method PUT "repos/$repo/rulesets/$ruleset_id" --input - >/dev/null
  echo "factory checks restored on $repo's factory ruleset (id $ruleset_id)"
  gh variable delete "$variable" --repo "$repo" >/dev/null 2>&1 || true
  echo "$variable cleared on $repo"
fi
