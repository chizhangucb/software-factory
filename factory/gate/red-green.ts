import { removesCode, type ChangedFile, type FileKind } from "./changed-files";
import type { Verdict } from "./test-integrity";

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

export interface RedGreenResults {
  readonly base: TestResult;
  readonly head: TestResult;
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

export const redGreenVerdict = (plan: RedGreenPlan, results?: RedGreenResults): Verdict => {
  if (!plan.run) {
    return plan.vacuous ? { ok: true, reasons: [] } : { ok: false, reasons: [plan.reason] };
  }
  if (!results) return { ok: false, reasons: ["tests were planned but never ran"] };
  const reasons: string[] = [];
  if (results.base.exitCode === 0) {
    reasons.push(`changed tests pass on the base (exit 0): the change is not proven by its tests (${plan.testFiles.join(", ")})`);
  }
  if (results.head.exitCode !== 0) {
    reasons.push(`changed tests fail on the head (exit ${results.head.exitCode}): ${plan.testFiles.join(", ")}`);
  }
  return { ok: reasons.length === 0, reasons };
};
