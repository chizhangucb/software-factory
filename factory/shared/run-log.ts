import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentStreamEvent, LoggingOption, RunResult } from "@ai-hero/sandcastle";
import { fail, outputDir } from "./common";

/**
 * Claude's final `result` event from stream-json, kept raw.
 *
 * sandcastle's parser drops `is_error` and `subtype` from this line and the
 * orchestrator only fails on a nonzero exit code, but `claude -p` exits 0 on a
 * rate limit or a refused request. So every factory run logs to a file with
 * the stream event hook, keeps each raw `result` line, and decides success
 * from those, never from the library's return value.
 */
export interface ResultEvent {
  readonly type: "result";
  readonly is_error?: boolean;
  readonly subtype?: string;
  readonly result?: string;
  /** Set when the final turn ended in an API error; 429 is a rate limit. */
  readonly api_error_status?: number | null;
  /** Error messages on the error_* subtypes. */
  readonly errors?: readonly string[];
  readonly [key: string]: unknown;
}

/** Parse one raw stdout line; undefined unless it is a `result` event. */
export const parseResultEvent = (line: string): ResultEvent | undefined => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { type?: unknown }).type !== "result"
  ) {
    return undefined;
  }
  return parsed as ResultEvent;
};

/**
 * The reason a run failed, or undefined when every observed result event
 * reports success. Zero result events is a failure too: the agent never
 * reached its final message.
 */
export const runFailure = (
  events: readonly ResultEvent[],
): string | undefined => {
  if (events.length === 0) {
    return "No result event was observed; the agent did not finish a turn.";
  }
  const bad = events.find((event) => event.is_error === true);
  if (!bad) return undefined;
  const detail =
    typeof bad.result === "string" && bad.result.trim().length > 0
      ? bad.result.trim()
      : JSON.stringify(bad);
  return `Agent reported an error (${bad.subtype ?? "unknown"}): ${detail}`;
};

export interface RunLog {
  readonly logging: LoggingOption;
  readonly logPath: string;
  readonly resultEvents: ResultEvent[];
  /** Persist the result events next to the log and return the run failure, if any. */
  finish(result?: Pick<RunResult, "logFilePath">): string | undefined;
}

/**
 * File logging for one factory run. Text and tool-call events are echoed to
 * stdout so the job log shows progress; raw `result` lines are captured for
 * the success decision and for rotation.
 */
export const createRunLog = (name: string): RunLog => {
  const logsDir = path.join(outputDir(), "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const logPath = path.join(logsDir, `${name}.log`);
  const resultEvents: ResultEvent[] = [];

  const onAgentStreamEvent = (event: AgentStreamEvent): void => {
    if (event.type === "raw") {
      const parsed = parseResultEvent(event.line);
      if (parsed) resultEvents.push(parsed);
      return;
    }
    if (event.type === "toolCall") {
      console.log(`[${name}] tool ${event.name} ${event.formattedArgs}`);
      return;
    }
    console.log(`[${name}] ${event.message}`);
  };

  return {
    logging: { type: "file", path: logPath, onAgentStreamEvent },
    logPath,
    resultEvents,
    finish() {
      fs.writeFileSync(
        path.join(logsDir, `${name}.result-events.json`),
        JSON.stringify(resultEvents, null, 2),
      );
      const failure = runFailure(resultEvents);
      console.log(
        `[${name}] ${resultEvents.length} result event(s); ` +
          (failure ? `FAILED: ${failure}` : "all reported success") +
          `; log at ${logPath}`,
      );
      return failure;
    },
  };
};

export type Settled<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: string };

/**
 * Run the agent and always settle the log, whether the library returned or
 * threw. A result event carrying `is_error` is the reason that gets reported,
 * since the library's own error (a missing output tag, say) is usually the
 * symptom of it.
 */
export const settleRun = async <T>(
  log: RunLog,
  runAgent: () => Promise<T>,
): Promise<Settled<T>> => {
  let result: T | undefined;
  let thrown: unknown;
  try {
    result = await runAgent();
  } catch (error) {
    thrown = error;
  }
  const failure = log.finish();
  if (failure) return { ok: false, failure };
  if (thrown !== undefined) {
    return {
      ok: false,
      failure: thrown instanceof Error ? thrown.message : String(thrown),
    };
  }
  return { ok: true, value: result as T };
};

/** `settleRun`, then exit the process on failure. */
export const runOrFail = async <T>(
  log: RunLog,
  runAgent: () => Promise<T>,
): Promise<T> => {
  const settled = await settleRun(log, runAgent);
  return settled.ok ? settled.value : fail(settled.failure);
};
