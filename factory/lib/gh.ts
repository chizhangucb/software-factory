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
 * stdin is never inherited, and no call outlives 60 seconds: a `gh` call that
 * decides to prompt, or that simply never answers, is killed rather than left
 * to hang the job that made it (#229). One number for every caller, so a
 * pass is bounded at 60s times the calls it makes and no caller (the
 * heartbeat sender least of all) needs a kill timer of its own. The bound
 * holds while `gh` leaves no grandchild on the pipes: the kill signals `gh`
 * alone, and the sync read returns when stdout and stderr reach EOF.
 *
 * The failure shape is the module's too. Every failed call throws one
 * `GhError`, described the same way and carrying the same fields, so no
 * caller renders its own line and no caller reads a decision back out of the
 * rendered one (#120).
 *
 * Builtins only, and imported with an explicit `.ts` extension, because
 * `dispatch.yml` and `update-branch.yml` run their scripts on bare
 * `node --experimental-strip-types` with no `npm ci`.
 */
import { execFileSync } from "node:child_process";

/**
 * 64 MB. Projected reads are KBs; this is the margin, not the plan (#19).
 * Not exported: the buffer is this wrapper's business, so no caller can spawn
 * `gh` with a smaller one and bring the ENOBUFS back.
 */
const GH_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * 60 seconds, measured rather than guessed (#229). A single page read is 0.4
 * to 0.8s against this repo and the fixture, and a 3 page crawl of 232 issues
 * is 1.85s, so 60s is about 100 pages: no plausible target has that many open.
 * `gh api` has no retry or backoff of its own, so a 60s call is a stalled
 * call and not a throttled one, and killing it leaves the 5 minute dispatcher
 * four minutes to finish its sweep and log what happened. A false fire is
 * cheap: one skipped sweep, and the next one is a heartbeat interval away
 * (`heartbeat/interval.ts`), which is the tightest reconciler deadline. So a
 * repair waits one more pass, not indefinitely.
 *
 * One number for every caller, decided once. A caller that could pick its own
 * re-opens the decision at every call site, which is the drift a single
 * wrapper exists to prevent.
 */
const GH_TIMEOUT_MS = 60_000;

/**
 * The number in force, read once for the process. `FACTORY_GH_TIMEOUT_MS`
 * exists so this wrapper's own test can prove the kill without waiting a
 * minute; it is not a per-call override, and no factory script sets it.
 * Anything but a positive number falls back to the constant, so a typo'd
 * seam value never reads as a test that waited the full minute on purpose.
 */
const readTimeoutMs = (raw: string | undefined): number => {
  const seam = Number(raw);
  return Number.isFinite(seam) && seam > 0 ? seam : GH_TIMEOUT_MS;
};

const ghTimeoutMs = readTimeoutMs(process.env.FACTORY_GH_TIMEOUT_MS);

/**
 * One line: the gh command (never a token, those travel in env) and why it
 * failed. Not exported: the one way to describe a failed call is to throw the
 * error below, so a caller has nothing to learn here.
 */
const describeGhFailure = (args: readonly string[], cause: unknown): string => {
  const command = `gh ${args.join(" ")}`;
  if (!(cause instanceof Error)) return `${command} failed: ${String(cause)}`;
  const { code, status, signal, stderr } = cause as Error & { code?: unknown; status?: unknown; signal?: unknown; stderr?: unknown };
  const detail = typeof stderr === "string" ? stderr.trim() : "";
  if (typeof code === "string") return `${command} failed: ${code} (${cause.message})`;
  if (typeof signal === "string") return `${command} failed: killed by ${signal}${detail ? `, ${detail}` : ""}`;
  if (typeof status === "number") return `${command} failed: exit ${status}${detail ? `, ${detail}` : ""}`;
  return `${command} failed: ${detail || cause.message}`;
};

/**
 * A failed `gh` call, described once and carrying what the call answered
 * with. The message names the command and the cause and nothing else: no
 * stack, and no token, since tokens travel in env and never in `args`.
 *
 * The fields are the point. A caller that has to tell two failures apart
 * reads them (update-branch's two documented 422s, `updateRefusal` in
 * `update-branch/plan.ts`) rather than matching patterns against the message,
 * which is prose written for a human reading a job log.
 *
 * Also thrown by a caller whose `gh` call succeeded but whose output was
 * unusable, with that as the cause: the sweep's non-JSON read is still a
 * failure of that command, and one shape describes it (#120).
 */
export class GhError extends Error {
  /** The arguments the command was run with. Tokens are never among them. */
  readonly args: readonly string[];
  /** The exit status, or null when the call was killed or never ran. */
  readonly status: number | null;
  /** What the call printed to stderr, empty when it printed nothing. */
  readonly stderr: string;
  /** The signal that killed the call, or null. */
  readonly signal: NodeJS.Signals | null;
  /**
   * Whether the call was killed by the wrapper's timeout. A derived boolean
   * rather than the libuv code, because the question a caller asks is whether
   * it timed out, and the answer stays true if the kill shape changes.
   */
  readonly timedOut: boolean;

  constructor(args: readonly string[], cause: unknown) {
    super(describeGhFailure(args, cause), { cause });
    this.name = "GhError";
    const { status, stderr, signal, code } = (cause ?? {}) as { status?: unknown; stderr?: unknown; signal?: unknown; code?: unknown };
    this.args = [...args];
    this.status = typeof status === "number" ? status : null;
    this.stderr = typeof stderr === "string" ? stderr : "";
    this.signal = typeof signal === "string" ? (signal as NodeJS.Signals) : null;
    this.timedOut = code === "ETIMEDOUT";
  }
}

/**
 * Run `gh` with the given arguments and return its stdout. Throws a `GhError`
 * on a non-zero exit, on a signal, on a spawn that never happened, and on a
 * call that outlives the wrapper's timeout, which is killed and carries
 * `timedOut`. Pass `env` to run one call under a different token (the sweep
 * reads statuses with GITHUB_TOKEN, update-branch posts them with it); tokens
 * travel in env, never in `args`, so a failure can be logged.
 */
export const gh = (args: readonly string[], env: NodeJS.ProcessEnv = process.env): string => {
  try {
    return execFileSync("gh", args as string[], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env,
      maxBuffer: GH_MAX_BUFFER,
      timeout: ghTimeoutMs,
    });
  } catch (error) {
    throw new GhError(args, error);
  }
};
