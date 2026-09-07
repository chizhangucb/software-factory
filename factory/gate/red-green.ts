import type { ChangedFile } from "./changed-files";
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

/**
 * Decides from the diff which tests to run. A removal ticket (Removes
 * section present) and a docs-only diff pass vacuously; a source change
 * with no test change is the placeholder shape the gate exists to catch.
 */
export const redGreenPlan = (files: readonly ChangedFile[], removes: readonly string[] | null): RedGreenPlan => {
  const testFiles = files
    .filter((f) => f.kind === "test" && f.status !== "D")
    .map((f) => f.path);
  if (testFiles.length > 0) {
    return { run: true, testFiles, vacuous: false, reason: `${testFiles.length} changed test file(s)` };
  }
  const touchesSource = files.some((f) => f.kind !== "doc");
  if (!touchesSource) return { run: false, testFiles: [], vacuous: true, reason: "docs only, nothing to prove" };
  if (removes !== null) return { run: false, testFiles: [], vacuous: true, reason: "removal ticket, no tests changed" };
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
