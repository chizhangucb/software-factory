/**
 * Token usage per factory run, and the PR comment that reports it (#18).
 *
 * The source is Claude Code's raw `result` event, one per `claude -p` call:
 * its `usage` block is the cumulative total for that call, and every call
 * in a job (the produce run, the extraction run, a rotation re-run) leaves
 * one such event in the attempt's run log. sandcastle's own
 * `iterations[].usage` is the last assistant message's snapshot, the size of
 * the context at the end, so summing it would not give what a run cost.
 * Pure functions; `usage-record.ts` does the file IO.
 */
import type { ResultEvent } from "./run-log";

export interface TokenUsage {
  readonly inputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly outputTokens: number;
}

/** One attempt of one run: what one account was asked to do, and what it used. */
export interface RunUsageRecord {
  /** implementer, reviewer, audit. Names the comment. */
  readonly role: string;
  /** The run name the script gave `runWithRotation`. */
  readonly name: string;
  readonly model: string;
  readonly account: string;
  readonly attempt: number;
  readonly wallMs: number;
  /** `claude -p` calls in this attempt (result events seen). */
  readonly calls: number;
  readonly turns: number;
  readonly usage: TokenUsage;
  /** Claude Code's `total_cost_usd` summed, at API list prices. */
  readonly costUsd: number;
  /** Set when the attempt ended in an error, rate limits included. */
  readonly failure?: string;
}

export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  outputTokens: 0,
};

const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
  cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

/** The `usage` block of one result event, or zero when the event has none. */
export const usageOfResultEvent = (event: ResultEvent): TokenUsage => {
  const usage = event.usage;
  if (typeof usage !== "object" || usage === null) return ZERO_USAGE;
  const u = usage as Record<string, unknown>;
  return {
    inputTokens: num(u.input_tokens),
    cacheCreationInputTokens: num(u.cache_creation_input_tokens),
    cacheReadInputTokens: num(u.cache_read_input_tokens),
    outputTokens: num(u.output_tokens),
  };
};

export interface AttemptSummary {
  readonly calls: number;
  readonly turns: number;
  readonly usage: TokenUsage;
  readonly costUsd: number;
}

/** Sum every result event of one attempt: produce, extraction, and their retries. */
export const summarizeResultEvents = (
  events: readonly ResultEvent[],
): AttemptSummary =>
  events.reduce<AttemptSummary>(
    (acc, event) => ({
      calls: acc.calls + 1,
      turns: acc.turns + num(event.num_turns),
      usage: addUsage(acc.usage, usageOfResultEvent(event)),
      costUsd: acc.costUsd + num(event.total_cost_usd),
    }),
    { calls: 0, turns: 0, usage: ZERO_USAGE, costUsd: 0 },
  );

export const totalUsage = (records: readonly RunUsageRecord[]): AttemptSummary & { wallMs: number } =>
  records.reduce(
    (acc, r) => ({
      calls: acc.calls + r.calls,
      turns: acc.turns + r.turns,
      usage: addUsage(acc.usage, r.usage),
      costUsd: acc.costUsd + r.costUsd,
      wallMs: acc.wallMs + r.wallMs,
    }),
    { calls: 0, turns: 0, usage: ZERO_USAGE, costUsd: 0, wallMs: 0 },
  );

export const USAGE_MARKER_PREFIX = "<!-- factory:usage:";

/**
 * The first line of a comment the workflow upserts, which it finds and
 * replaces a role's comment by. Not part of the table below: a caller that
 * posts the table as a comment of its own puts this on top of it, and the
 * audit, which nests the table inside its own comment, does not.
 */
export const usageMarker = (role: string): string => `${USAGE_MARKER_PREFIX}${role} -->`;

export const formatDuration = (ms: number): string => {
  const total = Math.round(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
};

const int = (n: number): string => Math.round(n).toLocaleString("en-US");
const usd = (n: number): string => `$${n.toFixed(2)}`;

/**
 * The usage table for one role: a heading, one row per attempt and a total.
 * Records of another role are ignored, so a script that ran two roles in one
 * job renders two tables.
 *
 * The `usageMarker` above is not glued on here. It belongs to a caller that
 * posts this as a comment of its own, and the audit nests the table inside a
 * comment that already carries a marker of its own.
 */
export const formatUsageComment = (
  role: string,
  records: readonly RunUsageRecord[],
  context: { readonly runUrl: string },
): string => {
  const rows = records.filter((r) => r.role === role);
  const lines = [`## Factory usage: ${role}`, ""];
  if (rows.length === 0) {
    lines.push(`No agent run was recorded for the ${role}. Run: ${context.runUrl}`);
    return lines.join("\n");
  }
  lines.push(
    "| run | model | wall | calls | turns | input | cache write | cache read | output | list cost |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const r of rows) {
    const name = r.failure ? `${r.name} (attempt ${r.attempt}, failed)` : `${r.name} (attempt ${r.attempt})`;
    lines.push(
      `| ${name} | ${r.model} | ${formatDuration(r.wallMs)} | ${r.calls} | ${r.turns} | ${int(r.usage.inputTokens)} | ${int(r.usage.cacheCreationInputTokens)} | ${int(r.usage.cacheReadInputTokens)} | ${int(r.usage.outputTokens)} | ${usd(r.costUsd)} |`,
    );
  }
  const total = totalUsage(rows);
  if (rows.length > 1) {
    lines.push(
      `| total | | ${formatDuration(total.wallMs)} | ${total.calls} | ${total.turns} | ${int(total.usage.inputTokens)} | ${int(total.usage.cacheCreationInputTokens)} | ${int(total.usage.cacheReadInputTokens)} | ${int(total.usage.outputTokens)} | ${usd(total.costUsd)} |`,
    );
  }
  const failures = rows.filter((r) => r.failure);
  for (const r of failures) {
    lines.push("", `Attempt ${r.attempt}: ${r.failure}`);
  }
  lines.push(
    "",
    "Tokens are summed from Claude Code's result events, one per `claude -p` call (extraction runs and rotation re-runs included). List cost is Claude Code's own estimate at API prices; the factory runs on subscription tokens (ADR 0001), so it is a reference figure, not a bill. " +
      `Run: ${context.runUrl}`,
  );
  return lines.join("\n");
};
