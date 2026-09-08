import type { AgentProvider } from "@ai-hero/sandcastle";

/**
 * Turn cap for a run.
 *
 * sandcastle's Claude provider has no flag passthrough, so the factory wraps
 * the provider it builds and appends `--max-turns N` to the print command.
 * Claude's CLI accepts options after the `-p -` prompt argument. When the cap
 * is hit the CLI emits a `result` event with `subtype: error_max_turns` and
 * `is_error: true`, which `run-log.ts` turns into a failed run, so a stuck
 * agent stops instead of burning the 60 minute job.
 */
export const maxTurnsCommand = (command: string, maxTurns: number): string => {
  if (!Number.isInteger(maxTurns) || maxTurns < 1) {
    throw new Error(`maxTurns must be a positive integer, got ${maxTurns}`);
  }
  return `${command} --max-turns ${maxTurns}`;
};

export const withMaxTurns = <A extends AgentProvider>(
  provider: A,
  maxTurns: number,
): A => ({
  ...provider,
  buildPrintCommand(options) {
    const base = provider.buildPrintCommand(options);
    return { ...base, command: maxTurnsCommand(base.command, maxTurns) };
  },
});
