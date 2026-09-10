#!/usr/bin/env bash
# A worked routing test command: the merge gate hands it a changed test file and
# it runs that file with the command its kind of test needs. Copy it into the
# target repo, edit the one mapping below, make it executable, and point the
# merge gate at it:
#
#     merge-gate:
#       uses: chizhangucb/software-factory/.github/workflows/merge-gate.yml@main
#       with:
#         test_command: ./scripts/factory-test-command.sh
#         install_command: npm ci && npx playwright install --with-deps chromium
#
# A target with one kind of test needs none of this: the merge gate already runs
# each changed test file on its own and passes over one it cannot run. This is
# what restores a real before-and-after proof for the second kind, which is
# otherwise merged on the reviewer's and the audit's judgment alone.
#
# Three things to know before editing:
#
#   - The merge gate calls this once per changed test file, so "$@" is usually
#     one path. Looping over all of them costs nothing and keeps it usable by
#     hand, which is how you will debug it.
#   - It also runs in a checkout of the base branch, with only the PR's changed
#     test files laid over it, so it has to be on the base branch to work there.
#     Land it there first, the way the caller itself is landed, by the
#     maintainer. Until it is, the base side of every routed file fails because
#     this file is missing rather than because the test is new, and a check that
#     goes green on that has proved nothing.
#   - Whatever the second kind of test needs installed is the caller's
#     `install_command`, not this file's business: the merge gate installs once
#     per checkout, and installing per file would pay for it once per test file.

set -uo pipefail

# EDIT THIS, and nothing else in this file: the mapping from a changed test file
# to the command that runs it.
#
# Reuse whatever your own CI already uses to tell your kinds of test apart,
# rather than writing a second rule here. Two rules drift, and the day they
# disagree the merge gate runs a browser spec under the unit command, watches it
# die on import, and passes it over as a file it could not run.
run_test_file() {
  case "$1" in
    test/browser/*|*.browser.spec.*) npx playwright test "$1" ;;
    *)                               node --test "$1" ;;
  esac
}

status=0
for file in "$@"; do
  echo "== $file"
  # Every file is run, never stopping at the first failure: the merge gate
  # judges each changed test file on its own, so each one needs its own answer.
  run_test_file "$file" || status=1
done
exit "$status"
