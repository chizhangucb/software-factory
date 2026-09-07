#!/usr/bin/env bash
# Post or replace one PR comment, keyed by the HTML marker on the body file's
# first line (`<!-- factory:usage:implementer -->`, `<!-- factory:audit -->`).
# One comment per marker per PR: a re-run edits, never duplicates (#18).
# usage: upsert-comment.sh <pr-number> <body-file>; GH_TOKEN and GH_REPO in env.
# Prints the comment URL and writes comment_url to GITHUB_OUTPUT when set.
set -euo pipefail
pr="$1"
file="$2"
if [ ! -s "$file" ]; then
  echo "No comment file at $file; nothing to post."
  exit 0
fi
marker=$(head -n1 "$file")
case "$marker" in
  "<!--"*"-->") ;;
  *) echo "First line of $file is not an HTML marker: $marker" >&2; exit 1 ;;
esac
existing=$(gh api "repos/${GH_REPO}/issues/${pr}/comments" --paginate \
  --jq "[.[] | select(.body | startswith(\"$marker\"))][0] | .id // empty" | head -n1)
if [ -n "$existing" ]; then
  url=$(gh api --method PATCH "repos/${GH_REPO}/issues/comments/${existing}" -F body=@"$file" --jq .html_url)
  echo "Replaced comment ($marker): $url"
else
  url=$(gh api --method POST "repos/${GH_REPO}/issues/${pr}/comments" -F body=@"$file" --jq .html_url)
  echo "Posted comment ($marker): $url"
fi
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "comment_url=$url" >> "$GITHUB_OUTPUT"
fi
