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
  /** The roll-up in the same file to wire it into, when the file has one. */
  readonly rollUp?: string;
}

interface Job {
  readonly key: string;
  readonly publishedName: string;
  readonly needs: readonly string[];
  /** A job-level `uses:` into another workflow file in this repo, if any. */
  readonly calls?: string;
  /** A matrix job publishes one check per combination, not its own name. */
  readonly matrix?: boolean;
}

interface Draft {
  key: string;
  name?: string;
  needs: string[];
  calls?: string;
  matrix?: boolean;
  /** true while `needs:` is opening a block list, so its `- x` lines are collected. */
  inNeeds: boolean;
  /** Indent of the job's own properties, taken from its first body line. */
  bodyIndent: number | undefined;
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

const unquote = (value: string): string => (/^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value);

/**
 * A line with its trailing comment gone, blank and comment-only lines reported
 * as empty. A `#` inside quotes or a `${{ }}` expression is left alone, so a
 * job `name:` carrying one survives.
 *
 * A quote opens a scalar only where one can start, never mid-word: an
 * apostrophe in `name: Don't break  # why` would otherwise open a string that
 * never closes, leave the comment glued to the name, and refuse a job whose
 * required context matches it perfectly.
 */
const stripComment = (line: string): string => {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = undefined;
      continue;
    }
    if ((c === '"' || c === "'") && (i === 0 || /[\s:,[{-]/.test(line[i - 1]))) quote = c;
    else if (c === "$" && line.startsWith("${{", i)) {
      const end = line.indexOf("}}", i);
      if (end < 0) return line.trimEnd();
      i = end + 1;
    } else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
};

/** `key:` or `"key":`, whatever follows it on the line. */
const KEY = /^["']?([A-Za-z_][\w.-]*)["']?:\s*(.*)$/;

/**
 * Job keys, the name each publishes, what each needs, and any job-level
 * `uses:`, from a file's `jobs:` block. Indentation is read rather than
 * assumed, and a property counts only at a job's own body indent, so a step's
 * `uses:` is never mistaken for a job's.
 */
const parseJobs = (source: string): Job[] => {
  const jobs: Job[] = [];
  let jobIndent: number | undefined;
  let inJobs = false;
  let current: Draft | undefined;
  const flush = (): void => {
    if (current)
      jobs.push({
        key: current.key,
        publishedName: current.name ?? current.key,
        needs: current.needs,
        ...(current.calls ? { calls: current.calls } : {}),
        ...(current.matrix ? { matrix: true } : {}),
      });
    current = undefined;
  };
  for (const raw of source.split("\n")) {
    const line = stripComment(raw);
    if (line.trim() === "") continue;
    const indent = indentOf(line);
    if (indent === 0) {
      flush();
      inJobs = /^["']?jobs["']?:/.test(line);
      jobIndent = undefined;
      continue;
    }
    if (!inJobs) continue;
    jobIndent ??= indent;
    const entry = line.trim().match(KEY);
    if (indent === jobIndent) {
      flush();
      if (entry) current = { key: entry[1], needs: [], inNeeds: false, bodyIndent: undefined };
      continue;
    }
    if (!current) continue;
    current.bodyIndent ??= indent;
    const item = line.trim().match(/^-\s*(.+)$/);
    if (current.inNeeds && item && indent >= current.bodyIndent) {
      current.needs.push(unquote(item[1].trim()));
      continue;
    }
    if (!entry || indent !== current.bodyIndent) {
      if (entry?.[1] === "matrix") current.matrix = true;
      continue;
    }
    current.inNeeds = false;
    const [, key, value] = entry;
    if (key === "name") current.name = unquote(value);
    else if (key === "needs") {
      current.needs.push(...parseNeeds(value));
      current.inNeeds = value === "";
    } else if (key === "uses") {
      // unquoted first: `uses: "./.github/workflows/x.yml"` is the same call.
      const target = unquote(value);
      if (target.startsWith("./")) current.calls = target.slice(2);
    }
  }
  flush();
  return jobs;
};

/** `needs: a`, `needs: [a, b]`, or empty when a block list follows. */
const parseNeeds = (value: string): string[] =>
  (/^\[.*\]$/.test(value) ? value.slice(1, -1).split(",") : [value])
    .map((n) => unquote(n.trim()))
    .filter((n) => n.length > 0);

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
  const lines = source.split("\n").map(stripComment);
  const start = lines.findIndex((l) => /^["']?on["']?:/.test(l));
  if (start < 0) return false;
  const inline = lines[start].replace(/^["']?on["']?:/, "").trim();
  if (inline) return /\bpull_request(_target)?\b/.test(inline);
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") continue;
    if (indentOf(line) === 0) break;
    if (/^\s+(-\s*)?["']?pull_request(_target)?["']?\b/.test(line)) return true;
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
    for (const job of jobs) if (standsFor(job, required)) walk(path, job.key);
  }
  return reached;
};

/**
 * A required name stands for this job. Three shapes beyond the plain name,
 * each one a name GitHub publishes that the job's own is only a prefix of:
 * a job calling another workflow reports `caller / inner` and never its own
 * name; a matrix job reports its name plus the combination
 * (`smoke (ubuntu-latest)`); a name carrying a `${{ }}` expression reports
 * whatever the expression resolved to. In each case the literal part before
 * the first `${{` is what a required context is matched against. Matching
 * loosely here is the safe side: a wrong refusal has no judge after it.
 */
const standsFor = (job: Job, required: readonly string[]): boolean => {
  if (required.includes(job.publishedName)) return true;
  if (job.calls && required.some((ctx) => ctx.startsWith(`${job.publishedName} / `))) return true;
  const literal = job.publishedName.split("${{")[0].trim();
  if (job.publishedName.includes("${{") && literal.length > 0)
    return required.some((ctx) => ctx.startsWith(literal));
  if (!job.matrix) return false;
  const prefixes = [literal, job.key].filter((p) => p.length > 0);
  return required.some((ctx) => prefixes.some((p) => ctx === p || ctx.startsWith(`${p} (`)));
};

/**
 * The roll-up to name in a file's failure: a required job that rolls something
 * up, which is what a new job can be added to. A required leaf like chronicle's
 * `gitleaks` rolls nothing up, so naming it would be advice nobody can follow.
 */
const rollUpIn = (jobs: readonly Job[], required: readonly string[]): string | undefined =>
  jobs.find((j) => standsFor(j, required) && (j.needs.length > 0 || j.calls))?.key;

export const unrequiredAddedJobs = ({ workflows, required }: UnrequiredInput): UnrequiredJob[] => {
  const byPath = new Map(workflows.map((f) => [f.path, parseJobs(f.head)] as const));
  const reached = reachedFromRequired(byPath, required);
  return workflows.flatMap((file) => {
    if (!runsOnPullRequest(file.head)) return [];
    const before = new Set(parseJobs(file.base ?? "").map((j) => j.key));
    const jobs = byPath.get(file.path) ?? [];
    const rollUp = rollUpIn(jobs, required);
    return jobs
      .filter((j) => !before.has(j.key) && !reached.has(idOf(file.path, j.key)))
      .map((j) => ({ path: file.path, key: j.key, ...(rollUp ? { rollUp } : {}) }));
  });
};
