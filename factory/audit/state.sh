#!/usr/bin/env bash
# Factory state in the target repo: `.factory/state.json` on the `factory-state`
# branch, read and written through the contents API (#18). A branch of its own
# so the default branch's ruleset and CI never see it; an orphan, so it carries
# no code. The fine-grained FACTORY_PAT can write contents but not repo
# variables (verified: 403 on actions/variables), hence a file.
#   state.sh get            prints the audited-merges count (0 when absent)
#   state.sh set <count>    writes it, creating the branch on first use
# GH_TOKEN and GH_REPO in env.
set -euo pipefail
BRANCH=factory-state
FILE=.factory/state.json

fetch() {
  # Empty when the file or the branch is absent; gh prints the error body on stdout, so drop it.
  local raw
  if raw=$(gh api "repos/${GH_REPO}/contents/${FILE}?ref=${BRANCH}" 2>/dev/null); then printf '%s' "$raw"; fi
}

case "${1:-}" in
  get)
    raw=$(fetch)
    if [ -z "$raw" ]; then echo 0; exit 0; fi
    jq -r '.content' <<<"$raw" | base64 -d | jq -r '.auditedMerges // 0'
    ;;
  set)
    count="${2:?count}"
    case "$count" in ''|*[!0-9]*) echo "count must be a non-negative integer, got '$count'" >&2; exit 1 ;; esac
    content=$(jq -nc --argjson n "$count" '{auditedMerges: $n, updatedAt: (now | todate)}')
    raw=$(fetch)
    if [ -z "$raw" ]; then
      if ! gh api "repos/${GH_REPO}/git/ref/heads/${BRANCH}" >/dev/null 2>&1; then
        tree=$(gh api --method POST "repos/${GH_REPO}/git/trees" \
          -f "tree[][path]=${FILE}" -f "tree[][mode]=100644" -f "tree[][type]=blob" -f "tree[][content]=${content}" --jq .sha)
        commit=$(gh api --method POST "repos/${GH_REPO}/git/commits" -f "message=factory state: audited merges ${count}" -f "tree=${tree}" --jq .sha)
        gh api --method POST "repos/${GH_REPO}/git/refs" -f "ref=refs/heads/${BRANCH}" -f "sha=${commit}" --silent
        echo "Created branch ${BRANCH} with ${FILE}: audited merges ${count}."
        exit 0
      fi
      sha_args=()
    else
      sha_args=(-f "sha=$(jq -r .sha <<<"$raw")")
    fi
    gh api --method PUT "repos/${GH_REPO}/contents/${FILE}" \
      -f "message=factory state: audited merges ${count}" -f "branch=${BRANCH}" \
      -f "content=$(printf '%s' "$content" | base64 | tr -d '\n')" "${sha_args[@]}" --silent
    echo "${FILE} on ${BRANCH}: audited merges ${count}."
    ;;
  *)
    echo "usage: state.sh get | set <count>" >&2
    exit 2
    ;;
esac
