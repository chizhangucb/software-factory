/**
 * One repository variable, read. The two switches a human sets on a target,
 * `FACTORY_PAUSED` (#256) and `FACTORY_CHECKS_WAIVED` (#244), sit in the same
 * place, answer the same way and fail the same way, so the shape of the read
 * lives here and each of `pause.ts` and `waiver.ts` supplies only its own name
 * and its own meaning.
 *
 * One copy because the two readers have to agree about the one case that is
 * not a failure: an unset variable is a 404. Two copies of that predicate is
 * two places for a target to be read as running while GitHub was refusing the
 * call.
 *
 * Builtins only and explicit `.ts`, so `send.ts` reaches it on bare
 * `node --experimental-strip-types`.
 */

/**
 * A GET of one variable's value, with no `--method`, so asking a target about
 * its own settings cannot start a job on it.
 */
export const variableReadArgs = (target: string, name: string): string[] => [
  "api",
  `repos/${target}/actions/variables/${name}`,
  "--jq",
  ".value",
];

/**
 * The value, or nothing: `gh` prints a trailing newline, and a variable set to
 * blank carries nothing to act on. Both switches take the value as the reason,
 * and a reason nobody can read is not one.
 */
export const variableValue = (raw: string): string | undefined => raw.trim() || undefined;

/**
 * Is this failed read the variable simply not being there? True of a read that
 * a token without Actions variables read made, too, which is why a caller that
 * turns on the answer asks `variablesReadableArgs` next.
 */
export const isUnset = (error: string): boolean => error.includes("HTTP 404");

/**
 * The second question a 404 raises: may this token read the target's variables
 * at all? A fine-grained token holding the repo but not Actions variables read
 * is answered 404 on a single variable, exactly as GitHub answers one that is
 * not set, so the one code cannot tell a missing variable from a missing
 * permission.
 *
 * The list tells them apart because it has an empty answer: a token that may
 * read gets 200 and a count of zero on a target with no variables, where one
 * that may not gets the same 404 as before. So a 404 here is the permission.
 *
 * A GET, like the read it disambiguates, and unpaginated: the count is the
 * whole of what is being asked for, and no page of it is read.
 */
export const variablesReadableArgs = (target: string): string[] => [
  "api",
  `repos/${target}/actions/variables`,
  "--jq",
  ".total_count",
];
