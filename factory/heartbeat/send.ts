/**
 * Send one pass of the heartbeat (#222). What a host runs on an interval:
 *
 *   GH_TOKEN=<token> node --experimental-strip-types factory/heartbeat/send.ts
 *
 * every 10 minutes, with a token that has contents write on every target in
 * `targets.ts` and nothing else. `DRY_RUN=1` reports the pass without sending a
 * dispatch, as `dispatch/sweep.ts` reads the same var.
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
import { gh } from "../lib/gh.ts";
import { sendHeartbeat } from "./heartbeat.ts";
import { TARGET_REPOS } from "./targets.ts";

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

const outcomes = sendHeartbeat({
  targets: TARGET_REPOS,
  wake: dryRun ? () => {} : wake,
  report: (outcome) => {
    // A plain line, not an `::error::` annotation: the host is not a GitHub
    // runner (a heartbeat on GitHub's own cron is the thing this replaces).
    if (outcome.outcome === "failed") console.error(`${at()} factory-sweep FAILED for ${outcome.target}: ${outcome.error}`);
    else console.log(`${at()} factory-sweep dispatched to ${outcome.target}${dryRun ? " (dry run)" : ""}`);
  },
});

const failed = outcomes.filter((outcome) => outcome.outcome === "failed");
console.log(`${at()} ${outcomes.length} target(s), ${outcomes.length - failed.length} woken, ${failed.length} failed${dryRun ? " (dry run)" : ""}.`);
if (failed.length > 0) process.exit(1);
