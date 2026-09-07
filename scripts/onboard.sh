#!/usr/bin/env bash
# Onboard a target repo: create the factory's labels. Secrets and the caller
# workflow are the other two steps; see README.md.
#   scripts/onboard.sh owner/repo
set -euo pipefail
repo="${1:?usage: onboard.sh owner/repo}"
label() { gh label create "$1" --repo "$repo" --color "$2" --description "$3" --force >/dev/null && echo "label $1"; }
label "agent:implement"   "1d76db" "Factory: run the implementer on this ticket"
label "agent:in-progress" "fbca04" "Factory: a run is active"
label "agent:review"      "5319e7" "Factory: run the reviewer on this PR"
label "agent:blocked"     "b60205" "Factory: last run failed, see the comment"
label "needs-human"       "d93f0b" "Factory: escalated, a human must read this"
