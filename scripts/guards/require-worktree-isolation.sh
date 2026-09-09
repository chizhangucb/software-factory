#!/usr/bin/env bash
# PreToolUse hook: a subagent's worktree comes from the harness, not from us.
#
# A hand-made worktree path in a subagent's prompt leaves that agent's session
# cwd at the repo root. Anything forking with that cwd then acts on the shared
# checkout: on 2026-09-08 the bundled code-review reviewed the wrong HEAD and
# wrote its --fix edits into the main working tree five times, and EnterWorktree
# refused for the same reason. `isolation: "worktree"` makes cwd, forked skills
# and nested agents agree.
#
# Scope: the Agent tool only. Building a worktree by hand is fine on its own;
# handing one to a subagent is the defect. Claude Code sessions only, so a Codex
# orchestrator neither trips this nor gains it.
#
# Contract: tool call as JSON on stdin, exit 2 blocks with the reason on stderr,
# exit 0 allows. An accident net, not a security boundary.

set -euo pipefail
input=$(cat)

# No jq: allow, quietly. This prevents an accident, so a missing tool must not
# block work, and must not put an error on every Agent call either.
command -v jq >/dev/null 2>&1 || exit 0

# Stdin that is not JSON is not this guard's business either: jq's parse error
# is swallowed and the empty read allows.
field() { printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null; }

if [ "$(field '.tool_name')" != "Agent" ]; then exit 0; fi
if [ "$(field '.tool_input.isolation')" = "worktree" ]; then exit 0; fi

prompt=$(field '.tool_input.prompt')
if [ -z "$prompt" ]; then exit 0; fi

# The hand-made shape: names a worktree AND hands over an absolute path. Either
# alone is legitimate; together they mean the caller built it and is pointing.
#
# An absolute path is any leading slash with at least two segments, so a
# checkout under /Volumes, /workspace or /opt counts the same as one under a
# home directory, and a leading `~` counts too: `~/wt/x` is the same handover
# written short. It starts at a line start or after anything that cannot
# continue a path, so prose punctuation counts and `(/Users/someone/wt/x)` is
# still a handover. The excluded run keeps a fragment inside a longer path or a
# URL from matching, so `https://example.com/tmp/x` is not read as a path, and
# the second segment keeps a slash command like `/to-tickets` out.
printf '%s' "$prompt" | grep -qi 'worktree' || exit 0
printf '%s' "$prompt" | grep -Eq '(^|[^A-Za-z0-9_/.~-])~?/[A-Za-z0-9_.~-]+/' || exit 0

cat >&2 <<'MSG'
worktree-guard: this Agent call names a worktree and hands over an absolute
path, without isolation: "worktree".

Pass the harness its own isolation and drop the path from the prompt:

    Agent({ prompt: "...", isolation: "worktree" })

The agent then starts inside its own worktree, the harness owns the lifecycle,
and the agent pushes its branch by name (a worktree's upstream is the branch it
was cut from, so an unnamed push lands there).

Read-only agent? Name the commit to read instead of a worktree path.
MSG
exit 2
