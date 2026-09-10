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

/** The command the merge gate falls back to, and the only one it can read.
 *  Exported so the caller's fallback and this module's rule are one string:
 *  two copies that drift stop detection without failing anything. */
export const DEFAULT_TEST_COMMAND = "node --test";

const isDefault = (testCommand: string): boolean => testCommand.trim().replace(/\s+/g, " ") === DEFAULT_TEST_COMMAND;

/** Arguments that make a test command emit a report this module can read.
 *  Empty for a command the merge gate does not understand. */
export const reportArgs = (testCommand: string): readonly string[] =>
  isDefault(testCommand) ? ["--test-reporter=tap"] : [];

/**
 * Whether the report shows a file whose process died before any test reported
 * a result. Two things have to be true, and the second is what keeps this from
 * excusing work: an entry carries the dead process's own exit status, and no
 * entry is a test result. A file whose tests reported and whose process then
 * died has run, and its non-zero exit is the file's own failure to answer for,
 * or "the merge gate could not run it" becomes a way through for a change
 * nothing proved.
 *
 * The indentation is the rest of the rule. The report writes an entry's keys
 * at one level and anything nested inside a key's value one level deeper, so a
 * test that failed comparing values with an `exitCode` field of their own
 * prints that field deeper than the entry's keys. Reading it as a dead process
 * would excuse a real failure, which is the one thing this module must never
 * do. For the same reason an entry opens only when no entry is open: a test
 * that failed comparing report text dumps that text, entry markers and all,
 * inside its own values.
 *
 * A process killed by a signal carries `exitCode: ~` and the signal's name, so
 * the marker is the field's presence at the entry's own level rather than the
 * number in it: matching digits alone reads a segfaulted or OOM-killed file as
 * one that ran and failed, which is the wrong blame this module exists to end.
 */
const processExitStatus = /^(\s*)exitCode: (?:\d+|~|null)$/;
const blockOpen = /^(\s*)---$/;
const blockClose = /^(\s*)\.\.\.$/;

const diedBeforeReporting = (report: string): boolean => {
  let died = false;
  let reported = false;
  let keyIndent: number | undefined;
  let carriesExitStatus = false;
  for (const line of report.split("\n")) {
    if (keyIndent === undefined) {
      const open = blockOpen.exec(line);
      if (open) {
        keyIndent = open[1].length;
        carriesExitStatus = false;
      }
      continue;
    }
    const close = blockClose.exec(line);
    if (close && close[1].length === keyIndent) {
      if (carriesExitStatus) died = true;
      else reported = true;
      keyIndent = undefined;
      continue;
    }
    const exit = processExitStatus.exec(line);
    if (exit && exit[1].length === keyIndent) carriesExitStatus = true;
  }
  return died && !reported;
};

/** What one file did, read from the test command's own report. "unknown"
 *  whenever the merge gate was given a command it cannot read: the caller
 *  must then treat the file as having run rather than guess at it. */
export const runnability = (testCommand: string, result: TestResult): Runnability => {
  if (!isDefault(testCommand)) return "unknown";
  if (result.exitCode === 0) return "ran";
  return diedBeforeReporting(result.output) ? "unrunnable" : "ran";
};
