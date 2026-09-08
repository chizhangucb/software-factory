/**
 * Vendored from sandcastle 0.12.0, `.sandcastle/agent-workflows/shared/diff-lines.ts`.
 * One forced difference (#47): `+++ /dev/null` (a deleted file) and `--- `
 * headers are handled explicitly, and a blank line no longer counts as context.
 * No story asked for it, but the gate maps findings onto changed lines (#13) and
 * without it a deleted file's hunk is attributed to the previous file and every
 * file gains a phantom trailing line, so reverting to his text would change
 * behaviour. Covered by `diff-lines.test.ts`, which has no upstream counterpart.
 */
export const parseDiffLines = (diff: string): Map<string, Set<number>> => {
  const files = new Map<string, Set<number>>();
  let currentFile: string | undefined;
  let newLine = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice("+++ b/".length);
      if (!files.has(currentFile)) {
        files.set(currentFile, new Set());
      }
      continue;
    }
    if (line.startsWith("+++ /dev/null")) {
      currentFile = undefined;
      continue;
    }
    if (line.startsWith("--- ")) continue;

    if (!currentFile) continue;

    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }

    if (line.startsWith("+")) {
      files.get(currentFile)?.add(newLine);
      newLine++;
      continue;
    }

    if (line.startsWith(" ")) {
      files.get(currentFile)?.add(newLine);
      newLine++;
    }
  }

  return files;
};
