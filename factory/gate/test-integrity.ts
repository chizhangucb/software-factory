import { isTestFile, type ChangedFile } from "./changed-files";
import { uncoveredDeletedTests } from "./removes";

export interface Verdict {
  readonly ok: boolean;
  readonly reasons: string[];
}

export interface Marker {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

/**
 * Markers that silence or narrow a test by their call shape, across the
 * runners the factory is likely to meet. Scanned only on added lines of test
 * files, so a source file's own `skip` option never trips the gate.
 */
const MARKER_PATTERNS: readonly RegExp[] = [
  /\b(?:test|it|describe|suite|context|bench)\s*\.\s*(?:skip|only|todo)\s*\(/,
  /\b(?:xit|xtest|xdescribe|xcontext|fit|fdescribe|ftest)\s*\(/,
  /\bt\s*\.\s*(?:skip|todo)\s*\(/,
  /@pytest\.mark\.skip|\bpytest\.skip\s*\(|@unittest\.skip|\bt\.Skip(?:Now)?\s*\(|@Ignore\b|@Disabled\b|\bskip\s+['"]|\bxit\s+['"]|\bpending\s*\(/,
];
const COMMENT_LINE = /^\s*(?:\/\/|#|\*|\/\*)/;

/**
 * An options object silencing a test: a `skip`, `only` or `todo` key whose
 * value is not `false`. The value class excludes whitespace so `(?!false\b)`
 * cannot be defeated by backtracking, which is how `{ skip: false }` used to
 * be reported (#134).
 */
const SILENCING_OPTION = /\{[^}]*\b(?:skip|only|todo)\s*:\s*(?!false\b)[^,}\s]/;

/**
 * A runner *invoked* on this line, chained segments and a TypeScript type
 * argument included, so `test(`, `test.each([...])(`, `t.test(` and
 * `test<Ctx>(` all count.
 *
 * It has to be a call rather than a mention: chronicle's own test suite has
 * the line `{ skip: (rel) => rel === 'test/removed-routes.test.mjs' }`, where
 * a bare `\btest\b` matches inside the path string.
 *
 * It also has to be tested separately from SILENCING_OPTION rather than
 * spliced in front of it. Requiring the runner positionally before the `{`
 * is defeated by any earlier brace, and the shapes that produce one are
 * routine: a template-literal title, a `.each([{...}])` table, a hoisted
 * options object.
 */
const RUNNER_CALL =
  /\b(?:test|it|describe|suite|context|bench)(?:\s*\.\s*\w+)*\s*(?:<[^<>()]*(?:<[^<>()]*>[^<>()]*)*>\s*)?\(/;

/**
 * An options object is a marker only alongside a runner call, because
 * `{ skip: ... }` is an ordinary object literal and a test file's own helper
 * may take one. chronicle#298 was refused for `sweep(report, { skip: pred })`,
 * where `sweep` is that file's own scanner and no test was silenced (#134).
 *
 * The cost is a silencing option on a line that names no runner: a project's
 * own wrapper, or a table row in a Go test. That direction is the safe one,
 * because this check is required in a target's ruleset, so a false positive
 * refuses correct work permanently and no retry can clear it, while a skip
 * that gets through here still has to pass red-green and the reviewer. Go's
 * common form, `t.Skip()`, is a call and stays caught above.
 *
 * Two known gaps, both older than #134 and neither narrowed by it, because
 * both come from matching one line at a time:
 * - SILENCING_OPTION's `[^}]*` stops at the first `}`, so a key behind a
 *   nested object on the same line (`test("x", { meta: { k: 1 }, skip: true })`)
 *   is missed. Closing it wants balanced-brace matching rather than a wider
 *   character class.
 * - An options object a formatter has wrapped (`test("x", {` then `skip: true,`
 *   on the next line) carries no `{` on the key's line, so neither half
 *   matches. Closing it wants the scan to carry state across lines.
 *
 * A silencing option that is also a marker in some form this list misses still
 * has to pass red-green and the reviewer.
 */
export const isMarkerLine = (text: string): boolean =>
  !COMMENT_LINE.test(text) &&
  (MARKER_PATTERNS.some((re) => re.test(text)) ||
    (SILENCING_OPTION.test(text) && RUNNER_CALL.test(text)));

/** Added lines in test files that introduce a skip, only, or todo marker. */
export const findNewMarkers = (diff: string): Marker[] => {
  const markers: Marker[] = [];
  let currentFile: string | undefined;
  let newLine = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      const p = line.slice("+++ b/".length);
      currentFile = isTestFile(p) ? p : undefined;
      continue;
    }
    if (line.startsWith("+++ /dev/null")) {
      currentFile = undefined;
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("diff --git")) continue;
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (line.startsWith("+")) {
      const text = line.slice(1);
      if (currentFile && isMarkerLine(text)) {
        markers.push({ path: currentFile, line: newLine, text: text.trim() });
      }
      newLine++;
    } else if (line.startsWith(" ")) {
      newLine++;
    }
  }
  return markers;
};

/** Test files the diff removes: deleted, or renamed to a non-test path. */
export const deletedTestFiles = (files: readonly ChangedFile[]): string[] =>
  files.flatMap((f) => {
    if (f.status === "D" && f.kind === "test") return [f.path];
    if (f.status === "R" && f.oldPath && isTestFile(f.oldPath) && !isTestFile(f.path)) return [f.oldPath];
    return [];
  });

export interface IntegrityInput {
  readonly files: readonly ChangedFile[];
  readonly diff: string;
  /** Subjects from the ticket's `## Removes` section, or null when it has none. */
  readonly removes: readonly string[] | null;
}

export const checkTestIntegrity = ({ files, diff, removes }: IntegrityInput): Verdict => {
  const reasons: string[] = [];
  const deleted = deletedTestFiles(files);
  if (removes === null) {
    for (const p of deleted) {
      reasons.push(`deleted test file ${p}; the linked ticket has no \`## Removes\` section`);
    }
  } else {
    for (const p of uncoveredDeletedTests(deleted, removes)) {
      reasons.push(`deleted test file ${p} is not covered by any Removes subject (${removes.join("; ") || "none listed"})`);
    }
  }
  for (const m of findNewMarkers(diff)) {
    reasons.push(`new skip/only/todo marker at ${m.path}:${m.line}: ${m.text}`);
  }
  return { ok: reasons.length === 0, reasons };
};
