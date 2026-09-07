/**
 * Reads for the sweep, the pure half: what each paginated `gh api` call
 * projects with `--jq`, how its output turns back into items, and how a
 * failed `gh` call is described. `sweep.ts` spawns the processes.
 *
 * A full workflow run is 10 KB of JSON (actor, repository, head commit,
 * referenced workflows); a page of 100 passed Node's 1 MB spawnSync buffer
 * on the fixture and the reconciler died with ENOBUFS. Every list read now
 * runs `gh api --paginate --jq <projection>`: gh follows the Link headers,
 * applies the projection to each page as it arrives, and prints one
 * compact item per line, so the process output is KBs whatever the page
 * count. The spawn buffer is generous on top.
 *
 * Imports use explicit `.ts` so the job runs on bare
 * `node --experimental-strip-types` without installing the engine.
 */

/** 64 MB. Projected reads are KBs; this is the margin, not the plan. */
export const GH_MAX_BUFFER = 64 * 1024 * 1024;

/** jq programs, one item per line: each keeps the fields `reconcile.ts` maps, under the raw GitHub names. */
export const PROJECTIONS = {
  runs: ".workflow_runs[] | {id, event, display_title, head_branch, status, conclusion, created_at, updated_at}",
  issues: ".[] | {number, title, pull_request: (.pull_request != null), labels: [.labels[] | {name}]}",
  /** The sweep mark sits at the head of a comment; 64 chars cover `<!-- factory:sweep miss=n -->`. */
  timeline: ".[] | {event, created_at, label: (if .label == null then null else {name: .label.name} end), body: ((.body // \"\") | .[0:64])}",
  jobs: ".jobs[] | {name, conclusion}",
} as const;

export type Projection = keyof typeof PROJECTIONS;

/** Single reads (`--jq` on one object). */
export const STATUSES_PROJECTION = "[.statuses[] | {context, state}]";

/** The items in `gh api --paginate --jq` output: one JSON value per line, nothing for an empty list. */
export const parseItems = (stdout: string): any[] =>
  stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`line ${i + 1} is not JSON: ${line.slice(0, 200)}`);
      }
    });

/** One line: the gh command (never a token, those travel in env) and why it failed. */
export const describeGhFailure = (args: readonly string[], error: unknown): string => {
  const command = `gh ${args.join(" ")}`;
  if (!(error instanceof Error)) return `${command} failed: ${String(error)}`;
  const { code, status, signal, stderr } = error as Error & { code?: unknown; status?: unknown; signal?: unknown; stderr?: unknown };
  const detail = typeof stderr === "string" ? stderr.trim() : "";
  if (typeof code === "string") return `${command} failed: ${code} (${error.message})`;
  if (typeof signal === "string") return `${command} failed: killed by ${signal}${detail ? `, ${detail}` : ""}`;
  if (typeof status === "number") return `${command} failed: exit ${status}${detail ? `, ${detail}` : ""}`;
  return `${command} failed: ${detail || error.message}`;
};
