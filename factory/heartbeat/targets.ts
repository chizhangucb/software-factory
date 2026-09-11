/**
 * The targets the heartbeat wakes: one line each, and adding a target is one
 * line. One sender covers any number of them, so no target carries a sender of
 * its own.
 *
 * factory-fixture is off the list (2026-09-11): it is private, so every sweep
 * bills a whole Actions minute, and an idle fixture was eating most of the
 * month's included minutes. Put it back while actively testing there.
 *
 * This module imports nothing, so `send.ts` reaches it on bare
 * `node --experimental-strip-types`.
 */
export const TARGET_REPOS: readonly string[] = [
  // "chizhangucb/factory-fixture",
  "chizhangucb/chronicle",
];
