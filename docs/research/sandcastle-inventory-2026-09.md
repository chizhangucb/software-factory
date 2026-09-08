---
snapshot: 2026-09-06
source: https://github.com/chizhangucb/software-factory/issues/21
cited-by: docs/adr/0002-vendored-sandcastle-engine.md, docs/adr/0001-subscription-plans-first.md
---

> **Snapshot, 2026-09-06. Not maintained.**
> This is research as it stood on the day it was written, kept in the repo only because ADR 0002 (vendor sandcastle's Actions pipeline) and ADR 0001's 2026-09-08 amendment rest on it. Do not update it: it is evidence for a decision, and rewriting it would erase what was known when the decision was made. If sandcastle moves, write a new dated snapshot and cite that instead. Its home is [issue #21](https://github.com/chizhangucb/software-factory/issues/21); the body below is the note from that ticket, unchanged.
> What the factory actually built from it is `docs/provenance/sandcastle.md`, which is current.

# Sandcastle 0.12.0 inventory: what v0 uses, what v1 might, what to ignore

Research note for [issue #21](https://github.com/chizhangucb/software-factory/issues/21). Date: 2026-09-06. Primary source is the code: a local clone of [mattpocock/sandcastle](https://github.com/mattpocock/sandcastle) at `e99f832` and the tarball from `npm pack @ai-hero/sandcastle@0.12.0`. Spec context: [#9](https://github.com/chizhangucb/software-factory/issues/9), tickets #10 to #20.

## TL;DR

- Repo HEAD `e99f832` is exactly tag `v0.12.0`. `git log v0.12.0..HEAD` is empty. Nothing to reconcile.
- The npm package is `dist/` only: 62 files, 14 MB unpacked, Effect bundled in. One runtime dependency (`@clack/prompts`), two optional peers (`@vercel/sandbox`, `@daytona/sdk`) that are never touched by `noSandbox()`. No install scripts, no native modules, no Docker needed to install or to run `noSandbox()`.
- The `.sandcastle/agent-workflows/**` scripts import only `@ai-hero/sandcastle`, `@ai-hero/sandcastle/sandboxes/no-sandbox`, `node:*`, a type-only `@standard-schema/spec`, and each other. No repo-relative import escapes `.sandcastle/`. Everything v0 needs is the npm package plus the copied files, plus `tsx`, `gh`, `git`, and the `claude` CLI on the runner.
- One catch: in the sandcastle repo `@ai-hero/sandcastle` resolves by Node self-reference to its own `dist/` after `npm run build`. The vendored workflows run `npm ci && npm run build` for that reason. The factory drops the build step and installs the package instead.
- Public surface used by v0: `run`, `claudeCode`, `noSandbox`, `Output.object`, and the types `RunOptions`, `RunResult`, `OutputObjectDefinition`. That is the whole contract. Everything else in the package is unused by the dogfood pipeline.
- Three gaps between the library and the v0 spec, detailed below: no `--max-turns` passthrough, `is_error` on Claude's result event is dropped so a rate limit looks like success, and the vendored review agent commits to the branch (v0 wants it read-only).

## 1. Package vs repo

| | Value | Source |
|---|---|---|
| Published version | 0.12.0, published 2026-06-29T20:16Z | `npm view @ai-hero/sandcastle@0.12.0` |
| Repo HEAD | `e99f832`, `git describe --tags` prints `v0.12.0` | local clone |
| Commits after tag | none | `git log v0.12.0..HEAD` |
| `files` | `["dist"]` only; `LICENSE`, `README.md`, `package.json` added by npm | `package.json` |
| Tarball contents | `dist/index.js` + 6 chunks, `dist/main.js` (bin `sandcastle`), 5 `dist/sandboxes/*.js`, `.d.ts` files, `dist/templates/**` (5 templates), source maps | `npm pack` listing, 62 files |
| Unpacked size | 14.6 MB (Effect and `@effect/*` are bundled by tsup, 33 `effect` refs in `index.js`) | `dist.unpackedSize`, grep on `dist/index.js` |
| Runtime deps | `@clack/prompts ^1.1.0` (pulls 5 tiny packages; clean install = 7 packages) | `npm i` into an empty dir |
| Peer deps | `@daytona/sdk ^0.164.0`, `@vercel/sandbox >=1.0.0`, both `optional: true`; npm does not install them | `peerDependenciesMeta` |
| Install scripts | none (no preinstall/install/postinstall in the package or its deps) | grep on installed `package.json` files |
| Native / Docker | none at install. `docker()` and `podman()` shell out to the daemon at runtime only. `noSandbox()` needs `sh`, `git`, and the agent CLI on PATH | `src/sandboxes/*.ts` |
| Node engine | no `engines` field; the dogfood workflows use Node 22 | `package.json`, `.github/workflows/*.yml` |
| Not in the package | `.sandcastle/`, `.github/`, `docs/`, `src/*.ts` sources and tests, ADRs, `CONTEXT.md`, `research/`, `ideas/`, `plans/` | `files` field |

The dogfood scripts import `@ai-hero/sandcastle` by package name while living inside that very repo. Node resolves that via the self-reference rule (a package can import itself through its `exports` map), so it hits `./dist/` after `npm run build`. That is why every agent workflow has an `npm ci` then `npm run build` step. In the factory, `npm i @ai-hero/sandcastle@0.12.0` replaces the build step and the scripts work unchanged.

Type-only wrinkle: `shared/common.ts` has `import type { StandardSchemaV1 } from "@standard-schema/spec"`. `tsx` erases it at runtime, so it is not needed to run. `dist/index.d.ts` also imports that package, so `npm i -D @standard-schema/spec` is needed if the factory typechecks its scripts. The package does not declare it as a dependency, which is a packaging bug on Matt's side.

## 2. The inventory

Legend for "used by v0": the ticket that uses it. Tickets: #10 vendor engine, #11 reviewer, #12 implementer prompt, #13 gate checks, #14 auto-merge, #15 dispatcher, #16 retry/escalation, #17 rotation, #18 audit and usage, #19 proof run.

### 2a. Exports from `@ai-hero/sandcastle` (main entry, `dist/index.d.ts`)

Values first, then types. Source of truth: `src/index.ts` and the final `export { ... }` line of `dist/index.d.ts`.

| Item | Purpose | Used by v0 | Plausible later use | Safe to ignore |
|---|---|---|---|---|
| `run()` | One AFK agent run: resolve prompt, create worktree or sandbox, loop iterations, collect commits, usage, structured output | yes: #10, #11, #12, #16, #18 (every script calls it, via `runWithExtraction` for review) | everything | no, the core |
| `claudeCode(model, opts)` | Agent provider: builds `claude --print --verbose --dangerously-skip-permissions --output-format stream-json --model M [--effort] [--resume] [--fork-session] -p -`, parses stream-json, reads usage from the session JSONL | yes: #10, #12, #18 (model per role via the `model` arg), #17 (`env` carries `CLAUDE_CODE_OAUTH_TOKEN`) | `effort`, `permissionMode` | no |
| `codex`, `copilot`, `cursor`, `opencode`, `pi` | Other agent providers, same interface | no | user story 25, swap vendor | yes for v0 |
| `Output.object({tag, schema, maxRetries})` | Declare structured output extracted from an XML tag in the agent's stdout, validated by any Standard Schema; `maxRetries` resumes the session and asks again | yes: #11 (review verdict JSON), #18 (audit) | any structured verdict | no |
| `Output.string({tag})` | Same, raw string | no | simpler verdicts | yes |
| `StructuredOutputError` | Thrown when extraction fails after retries | indirectly (catch in scripts) | error typing | mostly |
| `interactive()` | Launch the agent as an interactive TTY session | no | local debugging | yes |
| `createSandbox()` | Long-lived sandbox handle with `.run()`, `.exec()`, `.interactive()`, `.close()` | no | multi-step runs sharing one sandbox | yes |
| `createWorktree()` | Long-lived host worktree handle; `.run()`, `.createSandbox()` | no | parallel agents on one runner | yes |
| `createBindMountSandboxProvider`, `createIsolatedSandboxProvider` | Build a custom sandbox provider | no | custom runner isolation | yes |
| `transferClaudeSession`, `transferCodexSession`, `encodeProjectPath`, `claudeHostSessionPath`, `claudeSandboxSessionPath`, `findClaudeSessionOnHost`, `findCodexSessionOnHost` | Session JSONL path and cwd rewriting helpers | no directly (used internally by resume) | moving a session between runner and container | yes |
| `CwdError` | Bad `cwd` option | no | | yes |
| Types `RunOptions`, `RunResult`, `IterationResult`, `IterationUsage`, `LoggingOption`, `Timeouts` | Shape of `run()` in and out. `RunResult.iterations[i].usage` has input, cache creation, cache read, output tokens per iteration; `RunResult.commits`, `.branch`, `.stdout`, `.logFilePath`, `.resume`, `.fork` | yes: #10, #18 (usage comment), #16 (log file path) | | no |
| Type `OutputObjectDefinition`, `OutputStringDefinition`, `OutputDefinition` | Output declarations | yes: #11 via `run-with-extraction.ts` | | no |
| Type `PromptArgs` | `{{NAME}}` substitution map for `promptFile` | yes: every script | | no |
| Type `AgentStreamEvent` | `text`, `toolCall`, or `raw` line event, only in `logging: {type: "file", onAgentStreamEvent}` | not by the dogfood scripts. Should be: #17 needs the raw `result` line to read `is_error` (see section 4) | live log forwarding | no |
| Type `AgentProvider`, `AgentCommandOptions`, `PrintCommand`, `ClaudeCodeOptions`, `CodexOptions`, ... | Provider interface. Public, so a wrapper provider can add CLI flags | not today. Candidate for #12 turn cap (section 4) | custom flags | no |
| Type `SandboxHooks` | `onBeforeSync`, `onAfterSync` style lifecycle hooks | no | pre-run setup | yes |
| Type `MountConfig` | Extra bind mounts for docker/podman | no | | yes |
| Types `SandboxProvider`, `AnySandboxProvider`, `BindMount*`, `Isolated*`, `NoSandbox*`, `ExecResult`, `InteractiveExecOptions`, `BranchStrategy` and its 6 variants | Provider and branch strategy typing. `noSandbox` defaults to `{type: "head"}`: agent runs on the checked-out branch in cwd, no worktree | `NoSandboxProvider` is what `noSandbox()` returns; the rest no | `merge-to-head` or named branch if the factory ever runs two agents per runner | mostly |

### 2b. Sub-path exports (`@ai-hero/sandcastle/sandboxes/*`)

| Item | Purpose | Used by v0 | Plausible later use | Safe to ignore |
|---|---|---|---|---|
| `no-sandbox`: `noSandbox(opts)` | Run on the host, `exec` via `sh -c` in cwd, all three branch strategies. Options: `env`, `maxOutputTailChars` | yes: all five scripts, #10 onward | | no |
| `docker`: `docker(opts)`, `defaultImageName` | Build image from `.sandcastle/Dockerfile`, bind-mount worktree, uid alignment | no (only `.sandcastle/run.ts`) | self-hosted runner isolation | yes |
| `podman`: `podman(opts)`, `defaultImageName` | Same on Podman | no | | yes |
| `vercel`: `vercel(opts)` | Isolated Vercel Sandbox; git bundle sync in/out; needs `@vercel/sandbox` peer | no | cloud sandbox instead of GitHub runner | yes |
| `daytona`: `daytona(opts)` | Isolated Daytona sandbox; needs `@daytona/sdk` peer | no | same | yes |

Also in the package but not an entry point: `dist/main.js` (the `sandcastle` CLI: `init`, `run`, interactive; uses `@clack/prompts`) and `dist/templates/**` (scaffolds copied by `sandcastle init`). Neither is used by v0.

### 2c. Files under `.sandcastle/` (repo only, not in the package)

| Item | Purpose | Used by v0 | Plausible later use | Safe to ignore |
|---|---|---|---|---|
| `agent-workflows/shared/common.ts` (110 lines) | `required`, `fail` (writes `failure_reason.txt` to `OUTPUT_DIR`), `sh`, `safeSh`, `gh`, `writeJson`, `writeText`, `claudeAgent()` (hardcodes `claude-opus-4-8` and reads `CLAUDE_CODE_OAUTH_TOKEN`), `standardSchema` adapter, `asRecord/asString/asArray` | yes: #10 (copy), #12 and #18 (edit `claudeAgent` to take the model as input), #17 (token env injection point) | | no |
| `agent-workflows/shared/run-with-extraction.ts` (52) | Two-phase run: produce, then `run({resumeSession, output})` in the same session to extract JSON. Uses session resume on the host | yes: #11, #18 | any verdict extraction | no |
| `agent-workflows/shared/review-context.ts` (171) | `fetchPullRequestContext(pr)`: `gh pr view`, linked issue via `Closes #N`, REST reviews, GraphQL unresolved threads, `git diff main...HEAD`, diff line map | yes: #11, #18 | | no |
| `agent-workflows/shared/review-output.ts` (128) | Schemas for review and implement-pr JSON; `filterInlineComments` (drop comments off the diff), `filterReplies` | yes: #11 (extend schema with per-criterion checklist and verdict) | | no |
| `agent-workflows/shared/diff-lines.ts` (36) | `parseDiffLines`: unified diff to `Map<file, Set<newLine>>` | yes: #11 (via review-output). Also a good seed for #13 test-integrity | #13 | no |
| `agent-workflows/implement/implement.ts` (38) | `run()` on the issue with `gh issue view --comments` as context; fails if zero commits ahead of main | yes: #10, #12, #16 | | no |
| `agent-workflows/implement/prompt.md` (26) | Task, issue, context, rules: read CONTEXT.md and CODING_STANDARDS, typecheck, commit, no push, emit `<promise>COMPLETE</promise>` | yes: #12 rewrites it | | no |
| `agent-workflows/review/review.ts` (84) | `runWithExtraction` on PR context; writes `review_payload.json` (REST review body), `replies.json`, `summary.md`, `verdict.txt` (`improved` if commits else `clean`) | yes: #11 base, but the verdict semantics change (pass/fail per criteria, no commits) | | no |
| `agent-workflows/review/prompt.md` (33) | "Actively improve the branch", add tests, commit as one conventional commit. Not read-only | yes: #11 rewrites it to read-only | | no |
| `agent-workflows/review/extraction.md` (18) | Emit one `<output>` JSON block: summary, inlineComments, replies | yes: #11 extends | | no |
| `agent-workflows/implement-pr/implement-pr.ts` (86), `prompt.md` (28), `extraction.md` (20) | `agent:implement` on a PR: apply review threads, reply, comment | yes: #16 (the informed retry on an existing branch is this flow with the failure output as context) | | no |
| `agent-workflows/update-branch/update-branch.ts` (123), `prompt.md` (22), `extraction.md` (9) | Merge base into the PR branch; agent resolves conflicts | no (spec: conflicts escalate in v0) | update-branch agent, out of scope item 3 | yes for v0, keep on disk |
| `agent-workflows/explore/explore.ts` (62), `prompt.md` (27), `extraction.md` (12) | `agent:explore` on an issue: investigate, post one comment | no | research tickets, planner-lite | yes |
| `run.ts` (159) | Dogfood parallel-planner loop over Docker: plan, implement N in parallel, review, merge | no | planner (out of scope: "any planner that invents work") | yes |
| `plan-prompt.md`, `implement-prompt.md`, `merge-prompt.md`, `review-prompt.md` | Prompts for `run.ts` | no | same | yes |
| `CODING_STANDARDS.md` (126) | Sandcastle's own house rules, referenced by its prompts | no; the target repo's CLAUDE.md and CONTEXT.md take this role (user story 23) | | yes, but strip the reference from copied prompts |
| `Dockerfile` | Image for `docker()` runs | no | self-hosted isolation | yes |
| `test-interactive.ts`, `test-podman.ts`, `test-vercel.ts` | Manual smoke scripts for providers | no | | yes |
| `.env.example`, `.gitignore` | `CLAUDE_CODE_OAUTH_TOKEN` etc for local runs; ignores `.env` | no | | yes |

### 2d. Files under `.github/workflows/`

| Item | Purpose | Used by v0 | Plausible later use | Safe to ignore |
|---|---|---|---|---|
| `agent-implement.yml` (issues labeled `agent:implement`) | Refuse sub-issues and PRD-shaped issues, refuse if a collaborator PR already closes the issue, flip labels to `agent:in-progress`, checkout main with `AGENT_PAT` fallback `GITHUB_TOKEN`, branch `agent/issue-N-slug`, Node 22, `npm ci`, `npm run build`, `npm i -g @anthropic-ai/claude-code`, `npx tsx implement.ts`, force push, `gh pr create --draft` with `Closes #N`, add `agent:review`, on failure add `agent:blocked` and comment with `failure_reason.txt` and run URL, always remove `agent:in-progress`. 60 min timeout, concurrency per issue | yes: #10 (base), #11 (sub-issue refusal removed), #14 (add `gh pr merge --auto`), #16 (retry and `needs-human` replace `agent:blocked`), #17 (token pick before the run step) | | no |
| `agent-review.yml` (`pull_request_target` labeled `agent:review`) | Labels, checkout head SHA, `npm ci`, build, install claude, `npx tsx review.ts`, push with `--force-with-lease` against the head SHA (fails if the branch moved), POST review via REST, `gh pr ready`, post thread replies via GraphQL to REST id lookup | yes: #11 (drop the push, add the `factory/verdict` status check and PR body section) | | no |
| `agent-implement-pr.yml` (`pull_request_target` labeled `agent:implement`) | Same skeleton, runs `implement-pr.ts`, pushes if commits, posts replies and comments | yes: #16 retry path | | no |
| `agent-update-branch.yml` (`pull_request_target` labeled `agent:update-branch`) | Runs `update-branch.ts`, pushes merge or posts conflict comment | no | conflict resolution later | yes for v0 |
| `agent-explore.yml` (issues labeled `agent:explore`) | Runs `explore.ts`, posts a comment | no | | yes |
| `ci.yml` | `npm ci`, build, test on push to main (sandcastle's own CI) | no | | yes |
| `release.yml` | changesets publish to npm | no | | yes |

Two things every agent workflow shares that the factory must keep: `pull_request_target` on the PR-side workflows (needed because the labeled event on an out-of-date PR has no merge commit, per the comment in `agent-update-branch.yml`), and secrets read from the base repo which is exactly what a reusable workflow gets when the caller passes `secrets: inherit` or explicit secrets.

### 2e. Top-level `src/` modules (repo only; compiled into the package's chunks)

Test files omitted. "Used by v0" here means "runs inside `run()` with `noSandbox` + `claudeCode`".

| Module | Purpose | In the v0 code path | Later use | Ignore |
|---|---|---|---|---|
| `run.ts` | Public `run()`; wires prompt, provider, sandbox, logging, structured output, resume and fork | yes | | no |
| `Orchestrator.ts` | Iteration loop: exec the print command, parse stream, completion signal, idle and completion timeouts, usage capture, `resultText` | yes | | no |
| `AgentProvider.ts` | All six providers, stream parsers, session storage per agent | yes (claudeCode part) | other vendors | no |
| `SandboxProvider.ts`, `startSandbox.ts`, `SandboxFactory.ts`, `SandboxLifecycle.ts`, `sandboxExec.ts` | Provider interface, tag dispatch, head vs worktree mode, exec plumbing | yes (head mode) | | no |
| `sandboxes/no-sandbox.ts` | Host exec | yes | | no |
| `PromptResolver.ts`, `PromptPreprocessor.ts`, `PromptArgumentSubstitution.ts` | Load `promptFile`, `{{ARG}}` substitution, `` !`shell` `` blocks in prompt files (fail fast on expansion errors, ADR 0020) | yes | | no |
| `Output.ts`, `extractStructuredOutput.ts` | Structured output declaration and XML tag extraction plus retry | yes (#11) | | no |
| `SessionStore.ts`, `resumePrecheck.ts` | Locate and rewrite Claude and Codex session JSONL; fail fast if a resume target is missing | yes (review extraction resumes) | | no |
| `AgentStreamEmitter.ts`, `Display.ts`, `TextDeltaBuffer.ts`, `boundedTail.ts` | Event forwarding, terminal and file output, sentence buffering, bounded output tail | yes (stdout logging) | raw event capture for #17 | no |
| `WorktreeManager.ts`, `createWorktree.ts`, `CopyToWorktree.ts`, `mountUtils.ts`, `MountConfig.ts`, `resolveGitVolumeMounts` | Worktree creation, locking, copy-on-write, mounts | no in head mode | parallel agents per runner | yes |
| `DockerLifecycle.ts`, `PodmanLifecycle.ts`, `sandboxes/docker.ts`, `sandboxes/podman.ts`, `sandboxes/vercel.ts`, `sandboxes/daytona.ts`, `syncIn.ts`, `syncOut.ts`, `RecoveryMessage.ts` | Container and cloud providers, git bundle sync | no | isolation later | yes |
| `createSandbox.ts`, `interactive.ts` | Long-lived sandbox and TTY mode | no | | yes |
| `cli.ts`, `main.ts`, `InitService.ts`, `templates.ts`, `terminalCleanup.ts`, `shutdownRegistry.ts`, `EnvResolver.ts` | The `sandcastle` CLI, `init` scaffolding (GitHub Issues, Beads, custom tracker, Dockerfile), `.env` resolution | no | Beads tracker if ever | yes |
| `errors.ts`, `ErrorHandler.ts`, `CwdError.ts`, `resolveCwd.ts`, `raceAbortSignal.ts`, `mergeProviderEnv.ts`, `version.ts` | Error types, cwd validation, abort, env merge | yes (incidental) | | fine |

### 2f. `docs/` and `src/templates/`

| Item | Purpose | Used by v0 | Later | Ignore |
|---|---|---|---|---|
| `docs/content/docs/{index,agents,configuration}.mdx`, `meta.json` | The three pages of the Next.js + fumadocs site (`docs/app`, `docs/components`, `docs/lib`, `docs/package.json`): quick start, agent list, config options | no; read once when writing the factory README | | yes |
| `docs/adr/` (20 ADRs) | Design decisions. Relevant ones: 0010 structured output, 0011 resume is one iteration, 0015 no-sandbox in run, 0016 resume needs filesystem sessions, 0018 fork is session only, 0019 completion timeout, 0020 prompt expansion fails fast | reference for #11 and #17 | | keep as reading |
| `docs/agents/`, `docs/research/` | Matt's agent docs and sandbox provider research | no | | yes |
| `src/templates/blank` | `main.mts` + `prompt.md` scaffold | no | | yes |
| `src/templates/simple-loop` | Pick issues one by one and close them | no | | yes |
| `src/templates/sequential-reviewer` | Implement one issue, review, repeat; ships `CODING_STANDARDS.md` | no | | yes |
| `src/templates/parallel-planner` | Plan parallelizable issues, run on separate branches, merge | no | planner, out of scope | yes |
| `src/templates/parallel-planner-with-review` | Same plus review per branch | no | | yes |
| Repo `ideas/`, `plans/`, `research/`, `scripts/check-public-types-effect-free.mjs`, `CONTEXT.md`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md` | Matt's working notes and build guard | no | | yes |

## 3. Does everything v0 needs exist in the package plus the copied files

Yes, with three external tools and one type package.

- Imports across all `.sandcastle/agent-workflows/**/*.ts`: `node:fs`, `node:path`, `node:child_process`, `@ai-hero/sandcastle`, `@ai-hero/sandcastle/sandboxes/no-sandbox`, `@standard-schema/spec` (type only), and sibling files under `../shared/`. Checked with grep on every `import` line. No `../../src`, no `../../dist`.
- Runtime on the runner: `tsx` (the workflows run `npx tsx`, which downloads it on demand; pin it as a devDependency instead), `gh` (preinstalled on `ubuntu-latest`), `git`, `claude` (`npm i -g @anthropic-ai/claude-code`, unpinned in the dogfood yml; pin it).
- Types only: `@standard-schema/spec` for typecheck.
- The `npm run build` step in every workflow exists only for the self-reference trick and goes away.
- The `.sandcastle/CODING_STANDARDS.md` reference inside `implement/prompt.md` and `review/prompt.md` points at a file the target repo will not have. Replace with the target's `CLAUDE.md` and `CONTEXT.md` (already planned in #12).

## 4. Where the library and the v0 spec disagree

Found by reading `src/AgentProvider.ts` and `src/Orchestrator.ts`.

- Turn cap. `claudeCode()` has no way to add `--max-turns` or any extra CLI flag. Its options are `effort`, `env`, `captureSessions`, `sessionStorage`, `permissionMode`. The command string is fixed in `buildPrintCommand`. Options: (a) wrap the provider, since `AgentProvider` is a public type and `run()` accepts any object with that shape, so `{...claudeCode(m), buildPrintCommand: (o) => patch(claudeCode(m).buildPrintCommand(o))}` works; (b) rely on the 60 minute job timeout plus sandcastle's `idleTimeoutSeconds` and drop the turn cap; (c) fork the provider. (a) is ten lines and keeps the package pinned.
- Rate limit detection. `parseStreamJsonLine` maps Claude's final `{"type":"result", ...}` event to `{type: "result", result: obj.result}` and drops `is_error` and `subtype`. `Orchestrator` only fails on a nonzero exit code. `claude -p` exits 0 on a rate limit, so `run()` resolves and `RunResult.stdout` holds the error text, not the JSON. `isRateLimited` (#17) must therefore use `logging: {type: "file", path, onAgentStreamEvent}` and inspect `raw` events for the result line (`is_error: true`, `subtype`), or re-read the log file. The dogfood scripts use `logging: {type: "stdout"}`, which exposes no raw events. Switch the copied scripts to file logging; the log file path is also what #16 wants to link from the escalation comment.
- Read-only reviewer. The vendored review prompt says "actively improve the branch" and the workflow pushes the reviewer's commits with `--force-with-lease`. v0 user story 5 wants a reviewer that never edits. Keep `review.ts` and `review-context.ts`, replace `prompt.md` and drop the push and `gh pr ready` steps; add the status check.
- Model is hardcoded. `claudeAgent()` in `shared/common.ts` pins `claude-opus-4-8`. Turn it into a function of an env var or workflow input (#18 acceptance: models per role are inputs).
- Sub-issue refusal. `agent-implement.yml` step "Detect issue shape" refuses both sub-issues and issues with sub-issues. The spec removes the sub-issue half (user story 22). The PRD-shaped refusal can stay.
- Usage is per iteration, available. `RunResult.iterations[].usage` gives four token counts read from the session JSONL (`parseSessionUsage`). Sum over `iterations` for the PR comment (#18). Note the review flow does two `run()` calls (produce + extract); count both.
- Session resume on the runner works. `runWithExtraction` resumes by session id; with `noSandbox` the session file lives in `~/.claude/projects/` on the same runner, and `resumePrecheck` fails fast if it is missing. Nothing to change, but it means the produce and extract runs must be in the same job.
- `--dangerously-skip-permissions` is always passed by `run()` (`Orchestrator.ts:143`), regardless of provider. Fine on an ephemeral runner; worth stating in the factory README.

## Recommendation for the factory

- Depend on `@ai-hero/sandcastle@0.12.0` exactly (no caret), commit the lockfile and the tarball as #10 says, and add `tsx`, `@standard-schema/spec`, and a pinned `@anthropic-ai/claude-code` version. Delete the `npm run build` step from every copied workflow.
- Copy only `.sandcastle/agent-workflows/{shared,implement,review,implement-pr}` and the three matching workflows. Leave `update-branch`, `explore`, `run.ts`, the planner prompts, `CODING_STANDARDS.md`, the Dockerfile, and the test scripts out of the factory tree; they are one `git show` away if v1 wants them.
- Treat the public contract as five names: `run`, `claudeCode`, `noSandbox`, `Output`, and the `RunOptions`/`RunResult` types. Everything else in the package stays unused, and that is fine.
- Switch every copied script from `logging: {type: "stdout"}` to `{type: "file", path, onAgentStreamEvent}` so raw result lines reach the rotation module and the log file reaches the escalation comment.
- Wrap `claudeCode()` in a factory-owned `factoryAgent(model, token)` that adds `--max-turns` and sets the token env, rather than forking sandcastle for two flags.
- Do not plan on any upstream fix; the repo is silent since June 29 (see the peers note). Anything sandcastle lacks gets a ten-line wrapper in the factory, not a patch upstream.

## What the v0 spec should change

- #12 "Turn cap passed to the CLI": say how, since the library cannot. Either the provider wrapper above or drop the turn cap in favor of the job timeout plus sandcastle's `idleTimeoutSeconds` (default 600).
- #17 `isRateLimited` "reads the run's JSON result": be precise. The JSON result is not on `RunResult`; it is a raw stream line reachable only via file logging with `onAgentStreamEvent`. State that the module consumes captured raw `result` events (or the log file), not `RunResult.stdout`.
- #10 acceptance "The run's JSON result is checked for the error flag": same fix, and it belongs to the logging change, so make #10 switch logging to file mode as part of vendoring.
- #11: name the removal of the reviewer push and `gh pr ready` steps explicitly; the vendored reviewer is a writer and the acceptance test "makes no commits and pushes nothing" will fail on the unedited copy.
- #10 or #18: add `@standard-schema/spec` and a pinned claude-code version to the dependency list; the dogfood pipeline installs `@anthropic-ai/claude-code` unpinned on every run, which is the one moving part in an otherwise pinned engine.
- Spec "Engine" bullet: note that the copied scripts are the contract with sandcastle and the package is used through five exports, so a later swap to a vendor-native action only has to replace `run()` calls in three scripts.
