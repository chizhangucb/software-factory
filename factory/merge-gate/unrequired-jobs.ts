/**
 * Jobs a pull request adds to a target's CI that no required name stands for.
 *
 * Reads the workflow files, never what ran today, so a path filter that
 * correctly skipped a job cannot be mistaken for a missing one.
 */

export interface WorkflowFile {
  readonly path: string;
  /** The file's content on the PR head. */
  readonly head: string;
  /** The file's content on the merge base, absent when the PR adds the file. */
  readonly base?: string;
}

export interface UnrequiredJob {
  readonly path: string;
  readonly key: string;
  readonly publishedName: string;
  /** The required job in the same file to wire it into, when there is one. */
  readonly rollUp?: string;
}

interface Job {
  readonly key: string;
  readonly publishedName: string;
  readonly needs: readonly string[];
  /** A job-level `uses:` into another workflow file in this repo, if any. */
  readonly calls?: string;
}

interface Draft {
  key: string;
  name?: string;
  needs: string[];
  calls?: string;
  /** true while `needs:` is opening a block list, so its `- x` lines are collected. */
  inNeeds: boolean;
}

const JOB_KEY = /^\s{2}([A-Za-z_][\w-]*):\s*$/;

/** Job keys, the name each publishes, and what each needs, from a file's `jobs:` block. */
const parseJobs = (source: string): Job[] => {
  const jobs: Job[] = [];
  let inJobs = false;
  let current: Draft | undefined;
  const flush = (): void => {
    if (current)
      jobs.push({
        key: current.key,
        publishedName: current.name ?? current.key,
        needs: current.needs,
        ...(current.calls ? { calls: current.calls } : {}),
      });
    current = undefined;
  };
  for (const line of source.split("\n")) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    if (/^\S/.test(line)) {
      flush();
      inJobs = false;
      continue;
    }
    const key = line.match(JOB_KEY);
    if (key) {
      flush();
      current = { key: key[1], needs: [], inNeeds: false };
      continue;
    }
    if (!current) continue;
    const item = line.match(/^\s{6,}-\s*(.+?)\s*$/);
    if (current.inNeeds && item) {
      current.needs.push(unquote(item[1]));
      continue;
    }
    current.inNeeds = false;
    const name = line.match(/^\s{4}name:\s*(.+?)\s*$/);
    if (name) {
      current.name = unquote(name[1]);
      continue;
    }
    const needs = line.match(/^\s{4}needs:\s*(.*?)\s*$/);
    if (needs) {
      current.needs.push(...parseNeeds(needs[1]));
      current.inNeeds = needs[1] === "";
      continue;
    }
    const uses = line.match(/^\s{4}uses:\s*\.\/(\S+)\s*$/);
    if (uses) current.calls = unquote(uses[1]);
  }
  flush();
  return jobs;
};

/** `needs: a`, `needs: [a, b]`, or empty when a block list follows. */
const parseNeeds = (value: string): string[] =>
  (/^\[.*\]$/.test(value) ? value.slice(1, -1).split(",") : [value])
    .map((n) => unquote(n.trim()))
    .filter((n) => n.length > 0);

const unquote = (value: string): string =>
  /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;

export interface UnrequiredInput {
  readonly workflows: readonly WorkflowFile[];
  /** The names the target's merge rule requires, read from its ruleset. */
  readonly required: readonly string[];
}

/**
 * A workflow that fires on a pull request. Only those are judged: a release
 * or a schedule-only workflow posts no check a merge rule could require, so
 * refusing a job added to one would be a false refusal, and this check is
 * required in a target's ruleset with no judge after it.
 */
const runsOnPullRequest = (source: string): boolean => {
  const lines = source.split("\n");
  const start = lines.findIndex((l) => /^on:/.test(l));
  if (start < 0) return false;
  const inline = lines[start].slice("on:".length).trim();
  if (inline) return /\bpull_request(_target)?\b/.test(inline);
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    if (/^\s{2}(-\s*)?pull_request(_target)?\b/.test(line)) return true;
  }
  return false;
};

/** `path#key`, so reachability can cross a job-level `uses:` into another file. */
const idOf = (path: string, key: string): string => `${path}#${key}`;

/**
 * Every job a required name reaches: the ones a required name is published
 * under, plus the transitive `needs` closure behind them, plus every job of a
 * workflow file a reached job calls with a job-level `uses:`.
 */
const reachedFromRequired = (
  byPath: ReadonlyMap<string, readonly Job[]>,
  required: readonly string[],
): Set<string> => {
  const reached = new Set<string>();
  const walk = (path: string, key: string): void => {
    const id = idOf(path, key);
    if (reached.has(id)) return;
    const job = byPath.get(path)?.find((j) => j.key === key);
    if (!job) return;
    reached.add(id);
    for (const need of job.needs) walk(path, need);
    for (const called of byPath.get(job.calls ?? "") ?? []) walk(job.calls!, called.key);
  };
  for (const [path, jobs] of byPath) {
    for (const job of jobs) if (required.includes(job.publishedName)) walk(path, job.key);
  }
  return reached;
};

export const unrequiredAddedJobs = ({ workflows, required }: UnrequiredInput): UnrequiredJob[] => {
  const byPath = new Map(workflows.map((f) => [f.path, parseJobs(f.head)] as const));
  const reached = reachedFromRequired(byPath, required);
  return workflows.flatMap((file) => {
    if (!runsOnPullRequest(file.head)) return [];
    const before = new Set(parseJobs(file.base ?? "").map((j) => j.key));
    const jobs = byPath.get(file.path) ?? [];
    const rollUp = jobs.find((j) => required.includes(j.publishedName))?.key;
    return jobs
      .filter((j) => !before.has(j.key) && !reached.has(idOf(file.path, j.key)))
      .map((j) => ({ path: file.path, key: j.key, publishedName: j.publishedName, ...(rollUp ? { rollUp } : {}) }));
  });
};
