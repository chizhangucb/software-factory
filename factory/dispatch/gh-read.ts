/**
 * Reads for the sweep, the pure half: what each paginated `gh api` call
 * projects with `--jq`, and how its output turns back into items. `sweep.ts`
 * spawns the processes, and a failed one describes itself (`lib/gh.ts`).
 *
 * A full workflow run is 10 KB of JSON (actor, repository, head commit,
 * referenced workflows); a page of 100 passed Node's 1 MB spawnSync buffer
 * on the fixture and the reconciler died with ENOBUFS. Every list read now
 * runs `gh api --paginate --jq <projection>`: gh follows the Link headers,
 * applies the projection to each page as it arrives, and prints one
 * compact item per line, so the process output is KBs whatever the page
 * count. The spawn buffer (`lib/gh.ts`) is generous on top.
 *
 * Imports use explicit `.ts` so the job runs on bare
 * `node --experimental-strip-types` without installing the engine.
 */

/** jq programs, one item per line: each keeps the fields `reconcile.ts` maps, under the raw GitHub names. */
export const PROJECTIONS = {
  runs: ".workflow_runs[] | {id, event, display_title, head_branch, status, conclusion, created_at, updated_at}",
  /**
   * `updated_at` is the heartbeat's clock (#264): the same call, one field
   * more, and the sweep ignores it. Nothing else needs it, because the sweep
   * reads a label event or a head commit for an exact age.
   */
  issues: ".[] | {number, title, pull_request: (.pull_request != null), labels: [.labels[] | {name}], updated_at}",
  /** The sweep mark sits at the head of a comment; 64 chars cover `<!-- factory:sweep miss=n tries=m -->`. */
  timeline: ".[] | {event, created_at, label: (if .label == null then null else {name: .label.name} end), body: ((.body // \"\") | .[0:64])}",
  /**
   * A PR's own comments, for #230's marker. The marker sits at the head, as
   * the sweep mark does, so the same 64 chars cover it; the author travels
   * with it because a marker only suppresses the next comment when the trust
   * policy acts on whoever wrote it.
   */
  comments: '.[] | {body: ((.body // "") | .[0:64]), association: .author_association, login: .user.login}',
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
