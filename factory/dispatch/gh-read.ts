/**
 * Reads for the sweep, the pure half: what each `gh api` call projects with
 * `--jq`, how the page walk decides to continue, and how a failed `gh` call
 * is described. `sweep.ts` spawns the processes.
 *
 * A full workflow run is 10 KB of JSON (actor, repository, head commit,
 * referenced workflows); a page of 100 passed Node's 1 MB spawnSync buffer
 * on the fixture and the reconciler died with ENOBUFS. Every list read now
 * projects the handful of fields the reconciler maps (`reconcile.ts`), one
 * page per spawn, and the spawn buffer is generous on top.
 *
 * Imports use explicit `.ts` so the job runs on bare
 * `node --experimental-strip-types` without installing the engine.
 */

export const PER_PAGE = 100;
/** Pages per read. A busy repo has hundreds of runs in the window, not thousands. */
export const MAX_PAGES = 30;
/** 64 MB. Projected pages are KBs; this is the margin for an unprojected read, not the plan. */
export const GH_MAX_BUFFER = 64 * 1024 * 1024;

/** jq programs: each turns one GitHub page into the array `reconcile.ts` maps. Keys match the raw GitHub names. */
export const PROJECTIONS = {
  runs: "[.workflow_runs[] | {id, event, display_title, head_branch, status, conclusion, created_at, updated_at}]",
  issues: "[.[] | {number, title, pull_request: (.pull_request != null), labels: [.labels[] | {name}]}]",
  /** The sweep mark sits at the head of a comment; 64 chars cover `<!-- factory:sweep miss=n -->`. */
  timeline: "[.[] | {event, created_at, label: (if .label == null then null else {name: .label.name} end), body: ((.body // \"\") | .[0:64])}]",
  jobs: "[.jobs[] | {name, conclusion}]",
  statuses: "[.statuses[] | {context, state}]",
} as const;

export type Projection = keyof typeof PROJECTIONS;

export type Page = { page: number; received: number };
export type PageDecision = { next: number } | { done: "short page" | "page cap" };

/** A page shorter than PER_PAGE is the last one; the cap bounds a walk that never shortens. */
export const nextPage = ({ page, received }: Page): PageDecision => {
  if (received < PER_PAGE) return { done: "short page" };
  if (page >= MAX_PAGES) return { done: "page cap" };
  return { next: page + 1 };
};

export const pageUrl = (endpoint: string, page: number): string =>
  `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=${PER_PAGE}&page=${page}`;

/** One line: the gh command (never a token, those travel in env) and why it failed. */
export const describeGhFailure = (args: readonly string[], error: unknown): string => {
  const command = `gh ${args.join(" ")}`;
  if (!(error instanceof Error)) return `${command} failed: ${String(error)}`;
  const { code, status, stderr } = error as Error & { code?: unknown; status?: unknown; stderr?: unknown };
  const detail = typeof stderr === "string" ? stderr.trim() : "";
  if (typeof code === "string") return `${command} failed: ${code} (${error.message})`;
  if (typeof status === "number") return `${command} failed: exit ${status}${detail ? `, ${detail}` : ""}`;
  return `${command} failed: ${detail || error.message}`;
};
