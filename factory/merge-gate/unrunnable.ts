/**
 * Whether the merge gate managed to run a changed test file at all.
 *
 * Only the default test command is readable: the merge gate chooses that
 * invocation and can ask it for a structured report, so it can prove a file
 * never ran. A command the caller supplied is never parsed, because a wrong
 * guess about it would either hide a real failure or invent a fake excuse.
 * The rule about which commands are readable lives here, stated once, so no
 * caller can forget to ask.
 */
import type { TestResult } from "./red-green";

/** Whether the merge gate managed to run a changed test file at all. */
export type Runnability = "ran" | "unrunnable" | "unknown";

/** The command the merge gate falls back to, and the only one it can read. */
const DEFAULT_TEST_COMMAND = "node --test";

const isDefault = (testCommand: string): boolean => testCommand.trim().replace(/\s+/g, " ") === DEFAULT_TEST_COMMAND;

/** Arguments that make a test command emit a report this module can read.
 *  Empty for a command the merge gate does not understand. */
export const reportArgs = (testCommand: string): readonly string[] =>
  isDefault(testCommand) ? ["--test-reporter=tap"] : [];

/**
 * A dead process's own exit status, attached to the entry the report
 * synthesises for a file that never reported a test. A file that ran and
 * failed carries the assertion instead and no exit status.
 *
 * The indentation is the whole rule. The report writes an entry's keys at one
 * level and anything nested inside a key's value one level deeper, so a test
 * that failed comparing values with an `exitCode` field of their own prints
 * that field deeper than the entry's keys. Reading it as a dead process would
 * excuse a real failure, which is the one thing this module must never do.
 */
const processExitStatus = /^(\s*)exitCode: \d+$/;
const blockOpen = /^(\s*)---$/;
const blockClose = /^(\s*)\.\.\.$/;

const diedBeforeReporting = (report: string): boolean => {
  let keys: number | undefined;
  for (const line of report.split("\n")) {
    const open = blockOpen.exec(line);
    if (open) {
      keys = open[1].length;
      continue;
    }
    const close = blockClose.exec(line);
    if (close && close[1].length === keys) {
      keys = undefined;
      continue;
    }
    const exit = processExitStatus.exec(line);
    if (exit && exit[1].length === keys) return true;
  }
  return false;
};

/** What one file did, read from the test command's own report. "unknown"
 *  whenever the merge gate was given a command it cannot read: the caller
 *  must then treat the file as having run rather than guess at it. */
export const runnability = (testCommand: string, result: TestResult): Runnability => {
  if (!isDefault(testCommand)) return "unknown";
  if (result.exitCode === 0) return "ran";
  return diedBeforeReporting(result.output) ? "unrunnable" : "ran";
};
