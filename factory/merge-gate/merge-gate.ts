/**
 * Runs the two factory merge gate checks on a PR and writes their verdicts to
 * OUTPUT_DIR/merge-gate.json. The workflow turns that file into the
 * `factory/red-green` and `factory/test-integrity` commit statuses.
 *
 * Runs in the target checkout at the PR head with `origin/<base>` fetched.
 * The decisions live in pure modules next to this file; this script only
 * gathers inputs (diff, linked ticket number) and runs tests.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { gh, required, safeSh, sh, writeJson, writeText } from "../agent-workflows/shared/common";
import { linkedIssueNumber } from "../lib/linked-issue";
import { parseNameStatus, type ChangedFile } from "./changed-files";
import { redGreenPlan, redGreenVerdict, type FileRun, type TestResult } from "./red-green";
import { checkTestIntegrity } from "./test-integrity";
import { reportArgs, runnability } from "./unrunnable";

const prNumber = required("PR_NUMBER");
const baseRef = required("BASE_REF");
const testCommand = process.env.TEST_COMMAND?.trim() || "node --test";
/** Asked for once: only a command the merge gate chose emits a report it can read. */
const reportingTestCommand = [testCommand, ...reportArgs(testCommand)].join(" ");
const installCommand = process.env.INSTALL_COMMAND?.trim() ?? "npm ci";

const linkedIssue = (): string => linkedIssueNumber(gh(["pr", "view", prNumber, "--json", "body", "--jq", ".body"]));

const run = (cwd: string, cmd: string, args: string[] = []): TestResult => {
  const proc = spawnSync("sh", ["-c", `${cmd} "$@"`, "sh", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20 * 60 * 1000,
    // the PR's own tests run here: no GitHub credentials in their reach
    env: { ...process.env, CI: "1", GH_TOKEN: "", GITHUB_TOKEN: "" },
  });
  return { exitCode: proc.status ?? 1, output: `${proc.stdout ?? ""}${proc.stderr ?? ""}` };
};

const install = (cwd: string): void => {
  if (!installCommand) return;
  const result = run(cwd, installCommand);
  if (result.exitCode !== 0) {
    console.error(result.output);
    throw new Error(`install command failed in ${cwd}: ${installCommand}`);
  }
};

/**
 * Each file in its own invocation, so a failure belongs to the file that
 * failed rather than to every file that shared a batch with it. Install is the
 * worktree's, not the file's, and stays outside this loop.
 */
const runEach = (cwd: string, testFiles: readonly string[]): TestResult[] =>
  testFiles.map((file) => run(cwd, reportingTestCommand, [file]));

/** Checks out the base tip, overlays the head's test files, runs each of them alone. */
const runOnBase = (testFiles: readonly string[]): TestResult[] => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "merge-gate-base-"));
  sh(`git worktree add --detach "${baseDir}" "origin/${baseRef}"`);
  try {
    for (const file of testFiles) {
      fs.mkdirSync(path.join(baseDir, path.dirname(file)), { recursive: true });
      fs.copyFileSync(file, path.join(baseDir, file));
    }
    install(baseDir);
    return runEach(baseDir, testFiles);
  } finally {
    safeSh(`git worktree remove --force "${baseDir}"`);
  }
};

/**
 * One side's runs as one log, in plan order, except that the head's failures
 * are written last: a retry marker quotes this log's tail, so whichever file
 * broke is the output the implementer reads. The base keeps plan order,
 * because its own failure is every file passing, which singles out no file.
 */
const sideLog = (runs: readonly FileRun[], side: "base" | "head"): string => {
  const ordered =
    side === "head" ? [...runs].sort((a, b) => Number(a.head.exitCode !== 0) - Number(b.head.exitCode !== 0)) : runs;
  return ordered.map((r) => `=== ${r.path} (exit ${r[side].exitCode}) ===\n${r[side].output}`).join("\n");
};

const summarize = (name: string, ok: boolean, reasons: readonly string[], detail: string): string =>
  [`### ${name}: ${ok ? "pass" : "fail"}`, detail, ...reasons.map((r) => `- ${r}`), ""].join("\n");

const main = (): void => {
  const mergeBase = sh(`git merge-base "origin/${baseRef}" HEAD`).trim();
  const files: ChangedFile[] = parseNameStatus(sh(`git diff --name-status -M "${mergeBase}" HEAD`));
  const testPaths = files.filter((f) => f.kind === "test").map((f) => f.path);
  const diff = testPaths.length
    ? sh(`git diff "${mergeBase}" HEAD -- ${testPaths.map((p) => `"${p}"`).join(" ")}`)
    : "";
  const issueNumber = linkedIssue();

  const integrity = checkTestIntegrity({ files, diff });

  const plan = redGreenPlan(files);
  let runs: FileRun[] | undefined;
  if (plan.run) {
    const base = runOnBase(plan.testFiles);
    install(process.cwd());
    const head = runEach(process.cwd(), plan.testFiles);
    // The head decides: it is the version being merged, so it is the honest
    // authority on what the file now is, and a file it could not run is
    // passed over on the base side too.
    runs = plan.testFiles.map((file, i) => ({
      path: file,
      base: base[i],
      head: head[i],
      runnability: runnability(testCommand, head[i]),
    }));
    writeText("red-green-base.log", sideLog(runs, "base"));
    writeText("red-green-head.log", sideLog(runs, "head"));
  }
  const redGreen = redGreenVerdict(plan, runs);

  writeJson("merge-gate.json", {
    prNumber,
    baseRef,
    mergeBase,
    issueNumber,
    files,
    redGreen: {
      ...redGreen,
      plan,
      runs: runs?.map((r) => ({
        path: r.path,
        baseExit: r.base.exitCode,
        headExit: r.head.exitCode,
        runnability: r.runnability,
      })),
    },
    testIntegrity: integrity,
  });

  const summary = [
    summarize(
      "factory/red-green",
      redGreen.ok,
      redGreen.reasons,
      redGreen.detail,
    ),
    summarize(
      "factory/test-integrity",
      integrity.ok,
      integrity.reasons,
      [
        issueNumber ? `ticket #${issueNumber}` : "no linked ticket (`Closes #N` missing from the PR body)",
        integrity.deletedTests.length
          ? `deleted test files, for the reviewer and the audit to judge against the ticket: ${integrity.deletedTests.join(", ")}`
          : "no test file deleted",
      ].join("; "),
    ),
  ].join("\n");
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
};

main();
