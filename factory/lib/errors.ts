/**
 * What to print when a `catch` block has an `unknown`. Lifted out of the
 * vendored `agent-workflows/shared/common.ts`, where it was an unforced
 * addition: sandcastle has no such helper, and every caller (the retry
 * handler, the rotation wrapper, the run log) is factory-authored.
 */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
