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
