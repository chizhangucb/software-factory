/**
 * The hook contract for the worktree guard: a tool call as JSON on stdin, an
 * exit code out. 2 blocks with the reason on stderr, 0 allows.
 *
 * The guard is bash and reads stdin, so the one honest test runs it. That makes
 * this the second test in the repo to spawn a process, after
 * `factory/dispatch/gh-read.test.ts`, which runs the jq projections through
 * real jq. Still no network either way.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const guard = fileURLToPath(new URL("../../scripts/guards/require-worktree-isolation.sh", import.meta.url));

type Outcome = { code: number; stderr: string };

/** Feed the guard a tool call. `pathDir`, when given, replaces PATH. */
const run = (call: unknown, pathDir?: string): Outcome => {
  const env = pathDir === undefined ? process.env : { ...process.env, PATH: pathDir };
  const result = spawnSync(guard, { input: JSON.stringify(call), encoding: "utf8", env });
  if (result.error) assert.fail(`the guard did not run: ${result.error.message}`);
  return { code: result.status ?? -1, stderr: result.stderr };
};

/** Where a tool sits on a PATH, or "" if it is not there. */
const which = (tool: string, pathDir?: string): string => {
  const env = pathDir === undefined ? process.env : { ...process.env, PATH: pathDir };
  return spawnSync("/usr/bin/env", ["sh", "-c", `command -v ${tool} || true`], { encoding: "utf8", env }).stdout.trim();
};

/** A PATH holding the shell and the tools the guard runs, and deliberately no jq. */
const pathWithoutJq = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-guard-"));
  for (const tool of ["bash", "env", "cat", "grep"]) {
    const found = which(tool);
    assert.ok(found, `${tool} must be on PATH for the guard to run at all`);
    fs.symlinkSync(found, path.join(dir, tool));
  }
  assert.equal(which("jq", dir), "", "this PATH must not reach jq");
  return dir;
};

const handMadeWorktreeCall = { tool_name: "Agent", tool_input: { prompt: "Work in your worktree at /Users/someone/wt/x" } };

test("a prompt that names a worktree and hands over an absolute path, with no isolation, is blocked", () => {
  assert.equal(run(handMadeWorktreeCall).code, 2);
});

test("a blocked call names the fix: pass isolation worktree, drop the path from the prompt", () => {
  const { stderr } = run(handMadeWorktreeCall);
  assert.match(stderr, /isolation/i);
  assert.match(stderr, /worktree/i);
  assert.match(stderr, /drop the path/i);
});

test("any absolute path is a handover, `~/` included, not just one under a home or temp directory", () => {
  for (const dir of ["/Volumes/work/wt/x", "/workspace/wt/x", "/opt/wt/x", "/Users/someone/wt/x", "~/wt/x"]) {
    assert.equal(run({ tool_name: "Agent", tool_input: { prompt: `Work in your worktree at ${dir}` } }).code, 2, dir);
  }
});

test("a relative path and a slash command are not absolute paths, so they do not block", () => {
  const prompt = "You are in a worktree cut from main. Read docs/agents/build-and-review.md, run /to-tickets, and see https://example.com/tmp/x";
  assert.equal(run({ tool_name: "Agent", tool_input: { prompt } }).code, 0);
});

test("a path the prose wraps in parentheses is blocked, because punctuation is not isolation", () => {
  assert.equal(run({ tool_name: "Agent", tool_input: { prompt: "You are in your own worktree (/Users/someone/wt/x). Work only there." } }).code, 2);
});

test("the same call with isolation worktree is allowed, because the harness owns the worktree", () => {
  assert.equal(run({ tool_name: "Agent", tool_input: { ...handMadeWorktreeCall.tool_input, isolation: "worktree" } }).code, 0);
});

test("an absolute path with no worktree word is allowed, because pointing an agent at a file is not the defect", () => {
  assert.equal(run({ tool_name: "Agent", tool_input: { prompt: "Read the spec at /Users/someone/notes/spec.md and summarise it" } }).code, 0);
});

test("the worktree word with no path is allowed, because talking about worktrees is not the defect", () => {
  assert.equal(run({ tool_name: "Agent", tool_input: { prompt: "You are in a worktree cut from main. Push the branch by name." } }).code, 0);
});

test("a non-Agent tool is allowed, because building a worktree by hand on the shell is legitimate", () => {
  assert.equal(run({ tool_name: "Bash", tool_input: { command: "git worktree add /Users/someone/wt/x main" } }).code, 0);
});

test("a missing jq allows quietly, because the guard prevents an accident and must not stop real work", () => {
  const dir = pathWithoutJq();
  try {
    const { code, stderr } = run(handMadeWorktreeCall, dir);
    assert.equal(code, 0);
    assert.equal(stderr, "", "a machine with no jq must not see an error on every Agent call");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stdin that is not JSON allows quietly, for the same reason a missing jq does", () => {
  const result = spawnSync(guard, { input: "not json at all", encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "", "a parse error is not this guard's business and must not reach the caller");
});

test("the committed settings wire the guard on the Agent tool alone, through the project-directory variable", () => {
  const settings = JSON.parse(fs.readFileSync(new URL("../../.claude/settings.json", import.meta.url), "utf8"));
  const matchers = settings.hooks.PreToolUse;
  assert.deepEqual(matchers.map((m: any) => m.matcher), ["Agent"], "the Agent tool only: refusing a hand-built worktree on Bash was too broad");
  const commands = matchers.flatMap((m: any) => m.hooks).map((h: any) => h.command);
  assert.deepEqual(commands, ['"$CLAUDE_PROJECT_DIR/scripts/guards/require-worktree-isolation.sh"'], "no local path, so this survives the repo going public");
});
