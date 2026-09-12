/**
 * Send one pass of the heartbeat (#222). What a host runs on an interval:
 *
 *   GH_TOKEN=<token> node --experimental-strip-types factory/heartbeat/send.ts
 *
 * every 10 minutes, with a token that has contents write and issues and pull
 * requests read on every target in `targets.ts` and nothing else, the reads
 * being what says whether a target has anything waiting. `DRY_RUN=1` reports
 * the pass without touching a
 * target at all, as `dispatch/sweep.ts` reads the same var: no dispatch, and no
 * read either, so every target answers as one with work and the pass reports the
 * shape a busy interval takes.
 *
 * It holds no state: no log file of its own, no lock, nothing carried between
 * passes. Every outcome is a line on stdout and a failure is a line on stderr,
 * each stamped with the time as the script this replaces stamped its own log,
 * since a host's log keeps the history and cron and launchd timestamp nothing.
 * Its alerting sees the non-zero exit a failed target ends on. Where the whole
 * thing runs is #111.
 *
 * Builtins only, imported with explicit `.ts`, so it runs with no `npm ci`
 * (`send.test.ts` pins that).
 */
import { parseItems } from "../dispatch/gh-read.ts";
import { errorMessage } from "../lib/errors.ts";
import { gh } from "../lib/gh.ts";
import { READY_LABEL } from "../lib/labels.ts";
import { type TargetOutcome, sendHeartbeat } from "./heartbeat.ts";
import { TARGET_REPOS } from "./targets.ts";
import { WAIVER_VARIABLE, isUnset, waiverLine, waiverReadArgs, waiverReason } from "./waiver.ts";
import { type OpenSubject, fromGitHub, openWorkArgs } from "./work.ts";

const dryRun = process.env.DRY_RUN === "1";

/** The time, as the script this replaces stamped its own log lines. */
const at = (): string => new Date().toISOString();

/**
 * The dispatch that is the heartbeat, through the factory's one `gh` call, in
 * the same shape `sweep.ts` sends its own: explicit POST, `--silent` because
 * the answer is 204 and empty. A failed call throws a `GhError` naming the
 * command and the cause, which is what the outcome carries.
 */
const wake = (target: string): void => {
  gh(["api", "--method", "POST", `repos/${target}/dispatches`, "-f", "event_type=factory-sweep", "--silent"]);
};

/** What is open on a target, through the same `gh` call and the same projection the sweep reads. */
const readOpenWork = (target: string): OpenSubject[] => fromGitHub(parseItems(gh(openWorkArgs(target))));

/** A dry run reads no target, and answers as one with a ready ticket on it. */
const asIfBusy = (): OpenSubject[] => [{ pullRequest: false, labels: [READY_LABEL] }];

/**
 * The waiver nag (#244), every run: a target whose factory checks a human took
 * off is named until they are put back, because nothing closes a waiver
 * automatically. A read that fails for any reason other than the variable not
 * being there is said out loud and fails no target: the nag is not the pass.
 * It goes in the digest instead once there is one.
 *
 * A dry run reads no target here either, so it reports no waiver: the nag is
 * about a target's real state, and a dry run that invented one would be the one
 * output a maintainer could not trust.
 */
const nagIfWaived = (target: string): void => {
  if (dryRun) return;
  const line = waiverLine(target, readWaiverReason(target));
  if (line) console.log(`${at()} ${line}`);
};

/** One target's waiver reason, or nothing: an unset variable is a 404 and means no waiver. */
const readWaiverReason = (target: string): string | undefined => {
  try {
    return waiverReason(gh(waiverReadArgs(target)));
  } catch (error) {
    const message = errorMessage(error);
    if (!isUnset(message)) console.error(`${at()} could not read ${WAIVER_VARIABLE} on ${target}: ${message}`);
    return undefined;
  }
};

for (const target of TARGET_REPOS) nagIfWaived(target);

const outcomes = sendHeartbeat({
  targets: TARGET_REPOS,
  readOpenWork: dryRun ? asIfBusy : readOpenWork,
  wake: dryRun ? () => {} : wake,
  report: (outcome) => {
    // A plain line, not an `::error::` annotation: the host is not a GitHub
    // runner (a heartbeat on GitHub's own cron is the thing this replaces).
    if (outcome.outcome === "failed") console.error(`${at()} factory-sweep FAILED for ${outcome.target}: ${outcome.error}`);
    else if (outcome.outcome === "skipped") console.log(`${at()} ${outcome.target} skipped: nothing waiting`);
    else console.log(`${at()} factory-sweep dispatched to ${outcome.target}${dryRun ? " (dry run)" : ""}`);
  },
});

// Typed against the outcomes themselves: a member renamed in `heartbeat.ts`
// fails here rather than reporting none of it.
const count = (outcome: TargetOutcome["outcome"]): number => outcomes.filter((each) => each.outcome === outcome).length;
const failed = count("failed");
console.log(`${at()} ${outcomes.length} target(s), ${count("woken")} woken, ${count("skipped")} skipped, ${failed} failed${dryRun ? " (dry run)" : ""}.`);
// `exitCode`, not `process.exit`: stdout is a pipe when a host logs the pass,
// pipe writes are asynchronous, and exiting in place can drop the lines that
// say which target failed.
if (failed > 0) process.exitCode = 1;
