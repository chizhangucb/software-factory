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
 * Markers that silence or narrow a test, across the runners the factory is
 * likely to meet. Scanned only on added lines of test files, so a source
 * file's own `skip` option never trips the gate.
 *
 * The options-object pattern requires a runner call on the same line, because
 * `{ skip: ... }` is an ordinary object literal and a test file's own helper
 * may take one: chronicle#298 was refused for `sweep(report, { skip: pred })`,
 * where `sweep` is that file's own scanner and no test was skipped (#134).
 * What this deliberately stops catching is an options object passed to a
 * project's own wrapper around a runner. That is the safe direction: this
 * check is required in a target's ruleset, so a false positive blocks correct
 * work permanently and no retry can clear it, while a skip smuggled through an
 * unusual wrapper still has to get past red-green and the reviewer.
 * A same-line requirement is no narrower than the scan already was: the diff
 * is read line by line, so an object literal split across lines never had its
 * `{` on the `skip:` line and was never matched.
 *
 * The value class is `[^,}\s]` rather than `[^,}]` so `(?!false\b)` cannot be
 * defeated by backtracking. With whitespace allowed as the value character,
 * `{ skip: false }` still matched: `\s*` gave back the space, the lookahead
 * landed on that space instead of on `false`, and the space itself satisfied
 * the value. Excluding whitespace forces `\s*` to consume it all, so the
 * lookahead sees the value it is there to inspect (#134).
 */
const MARKER_PATTERNS: readonly RegExp[] = [
  /\b(?:test|it|describe|suite|context|bench)\s*\.\s*(?:skip|only|todo)\s*\(/,
  /\b(?:xit|xtest|xdescribe|xcontext|fit|fdescribe|ftest)\s*\(/,
  /\bt\s*\.\s*(?:skip|todo)\s*\(/,
  /\b(?:test|it|describe|suite|context|bench)\s*(?:\.\s*\w+\s*)?\([^{]*\{[^}]*\b(?:skip|only|todo)\s*:\s*(?!false\b)[^,}\s]/,
  /@pytest\.mark\.skip|\bpytest\.skip\s*\(|@unittest\.skip|\bt\.Skip(?:Now)?\s*\(|@Ignore\b|@Disabled\b|\bskip\s+['"]|\bxit\s+['"]|\bpending\s*\(/,
];
const COMMENT_LINE = /^\s*(?:\/\/|#|\*|\/\*)/;

export const isMarkerLine = (text: string): boolean =>
  !COMMENT_LINE.test(text) && MARKER_PATTERNS.some((re) => re.test(text));

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
