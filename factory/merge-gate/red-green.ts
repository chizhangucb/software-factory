import { removesCode, type ChangedFile, type FileKind } from "./changed-files";
import type { Verdict } from "./test-integrity";
import type { Runnability } from "./unrunnable";

export interface RedGreenPlan {
  /** Whether the tests need running at all; false means the verdict is decided by the diff alone. */
  readonly run: boolean;
  /** Head versions of the new or changed test files, to overlay on the base and run alone. */
  readonly testFiles: string[];
  /** When not running: true passes the check outright, false fails it. */
  readonly vacuous: boolean;
  readonly reason: string;
}

export interface TestResult {
  readonly exitCode: number;
  readonly output: string;
}

/**
 * One changed test file's outcome on each side. Each file is run in its own
 * invocation of the test command, so a failure can name the file that failed
 * and no other: a batch could only name every file it ran.
 */
export interface FileRun {
  readonly path: string;
  readonly base: TestResult;
  readonly head: TestResult;
  /** Decided by the head: it is the version being merged, so it is the honest authority on what the file now is. */
  readonly runnability: Runnability;
}

export interface RedGreenVerdict extends Verdict {
  /**
   * Changed test files the merge gate could not run, passed over on both
   * sides and named for the reviewer and the audit; never a reason to fail.
   */
  readonly unrunnable: string[];
  /** What the check saw, one line, for the status summary. */
  readonly detail: string;
}

/** What a vacuous pass says it saw, when the whole diff is one kind. */
const ONLY_KIND: Partial<Record<FileKind, string>> = { doc: "docs only", config: "config only" };

/**
 * Decides from the diff alone which tests to run. Nothing here reads the
 * ticket. A diff that changes no source file, and a diff that deletes a
 * source or test file (a test renamed out of the test tree counts as its
 * deletion) while adding or changing no test, both pass vacuously: the
 * second says in words that nothing was proved, because a removal has no
 * new test to go red on the base, and whether the removal was owed is the
 * reviewer's and the audit's call. Accepted as a false negative: a source
 * change that also deletes a source or test file slips this check and meets
 * the reviewer; the same change refused here would meet nobody. A deleted
 * doc or config file excuses nothing: it removes nothing a test could have
 * proved. A source change with no such deletion and no test change is the
 * placeholder shape this check exists to catch, and still fails.
 */
export const redGreenPlan = (files: readonly ChangedFile[]): RedGreenPlan => {
  const testFiles = files
    .filter((f) => f.kind === "test" && f.status !== "D")
    .map((f) => f.path);
  if (testFiles.length > 0) {
    return { run: true, testFiles, vacuous: false, reason: `${testFiles.length} changed test file(s)` };
  }
  if (!files.some((f) => f.kind === "source")) {
    const kinds = new Set(files.map((f) => f.kind));
    const only = kinds.size === 1 ? ONLY_KIND[[...kinds][0]] : undefined;
    return { run: false, testFiles: [], vacuous: true, reason: `${only ?? "no source change"}, nothing to prove` };
  }
  if (files.some(removesCode)) {
    return { run: false, testFiles: [], vacuous: true, reason: "files deleted, no test added or changed, nothing proved" };
  }
  return { run: false, testFiles: [], vacuous: false, reason: "source changed, no test file added or changed" };
};

/**
 * One line for the status summary: what the check ran, and what it passed
 * over. A file the merge gate could not run is named with the reason, the
 * same route the deleted-test decision established, so the reviewer and the
 * audit read it. When every file was passed over the line says plainly that
 * nothing was proved, because a check that refuses what it cannot judge
 * blocks correct work while one that passes and says so hands the judgment to
 * readers who can read.
 */
const detailOf = (plan: RedGreenPlan, judged: readonly FileRun[], unrunnable: readonly FileRun[]): string => {
  const parts = [plan.reason];
  if (judged.length > 0) {
    parts.push(judged.map((r) => `${r.path} base ${r.base.exitCode} head ${r.head.exitCode}`).join(", "));
  }
  if (unrunnable.length > 0) {
    const names = unrunnable.map((r) => r.path).join(", ");
    parts.push(
      judged.length === 0
        ? `nothing was proved: the merge gate could not run ${names}`
        : `passed over, the merge gate could not run: ${names}`,
    );
  }
  return parts.join("; ");
};

/**
 * Judges the per-file runs. At least one changed test file must fail on the
 * base, not all of them: requiring all would newly refuse a PR that adds a
 * real new test in one file and tidies the wording of another, which is
 * correct work, and the batch this replaced gave the weaker rule by accident
 * (a non-zero batch meant at least one file failed). A file that fails on the
 * head fails the check and is named alone, so an implementer reading the
 * status is never pointed at a test that passed.
 */
export const redGreenVerdict = (plan: RedGreenPlan, runs?: readonly FileRun[]): RedGreenVerdict => {
  if (!plan.run) {
    const reasons = plan.vacuous ? [] : [plan.reason];
    // A failing plan's reason is its own bullet already, so the detail would only repeat it.
    return { ok: plan.vacuous, reasons, unrunnable: [], detail: plan.vacuous ? plan.reason : "" };
  }
  if (!runs) return { ok: false, reasons: ["tests were planned but never ran"], unrunnable: [], detail: "" };
  const unrunnable = runs.filter((r) => r.runnability === "unrunnable");
  const judged = runs.filter((r) => r.runnability !== "unrunnable");
  const reasons: string[] = [];
  // Nothing judged means nothing to require: every file was passed over, and the detail says so.
  if (judged.length > 0 && !judged.some((r) => r.base.exitCode !== 0)) {
    reasons.push(
      `changed tests pass on the base (exit 0): the change is not proven by its tests (${judged.map((r) => r.path).join(", ")})`,
    );
  }
  for (const run of judged.filter((r) => r.head.exitCode !== 0)) {
    reasons.push(`changed test fails on the head (exit ${run.head.exitCode}): ${run.path}`);
  }
  return {
    ok: reasons.length === 0,
    reasons,
    unrunnable: unrunnable.map((r) => r.path),
    detail: detailOf(plan, judged, unrunnable),
  };
};
