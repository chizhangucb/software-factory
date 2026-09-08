/**
 * The factory's one `gh` call. Every script that shells out to the GitHub CLI
 * goes through here: the dispatcher and its sweep, update-branch, the
 * preflight, the retry handler, and the vendored `agent-workflows/shared`
 * helpers. One wrapper means one buffer, one stdio shape, and one place to
 * change when any of that is wrong.
 *
 * The buffer is the reason this module exists. A full workflow run is 10 KB
 * of JSON, and a page of 100 passed Node's 1 MB `spawnSync` default: the
 * reconciler died with ENOBUFS on the fixture (#19). Reads project with
 * `--jq` so the output is KBs whatever the page count; 64 MB is the margin,
 * not the plan.
 *
 * stdin is never inherited: a `gh` call that decides to prompt would
 * otherwise hang the job until its timeout.
 *
 * Builtins only, and imported with an explicit `.ts` extension, because
 * `dispatch.yml` and `update-branch.yml` run their scripts on bare
 * `node --experimental-strip-types` with no `npm ci`.
 */
import { execFileSync } from "node:child_process";

/** 64 MB. Projected reads are KBs; this is the margin, not the plan (#19). */
export const GH_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Run `gh` with the given arguments and return its stdout. Throws the
 * `execFileSync` error on a non-zero exit, with `status`, `stderr` and
 * `signal` on it. Pass `env` to run one call under a different token (the
 * sweep reads statuses with GITHUB_TOKEN, update-branch posts them with it);
 * tokens travel in env, never in `args`, so a failure can be logged.
 */
export const gh = (args: readonly string[], env: NodeJS.ProcessEnv = process.env): string =>
  execFileSync("gh", args as string[], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env,
    maxBuffer: GH_MAX_BUFFER,
  });
