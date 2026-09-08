/**
 * A PR that conflicts with its base cannot be brought up to date by
 * GitHub's update-branch call, and no merge queue resolves conflicts either.
 * update-branch hands such a PR to the implementer (`agent:implement` on the
 * PR); this module tells the implement-PR run whether its branch conflicts
 * and renders the prompt section that asks the agent to merge the base and
 * resolve. Pure functions over `git merge-tree` output; implement-pr.ts runs
 * git.
 */

/** What `git merge-tree --write-tree` reports as conflicting: file paths for content conflicts, the message for other kinds. */
export const parseMergeTreeConflicts = (input: {
  /** Exit status of `git merge-tree --write-tree <base> <head>`: 0 clean, 1 conflicts. */
  readonly status: number;
  readonly stdout: string;
}): readonly string[] => {
  if (input.status === 0) return [];
  const lines = input.stdout.split("\n").map((l) => l.trimEnd()).filter((l) => l.length > 0);
  const conflicts: string[] = [];
  for (const line of lines) {
    if (!line.startsWith("CONFLICT")) continue;
    // Content conflicts name the file; other kinds (modify/delete, rename) are kept as their message.
    const entry = /^CONFLICT \(content\): Merge conflict in (.+)$/.exec(line)?.[1] ?? line;
    if (!conflicts.includes(entry)) conflicts.push(entry);
  }
  return conflicts.length > 0 ? conflicts : ["(git merge-tree reported a conflict without naming a file)"];
};

/** The prompt section for a conflicting branch; empty when there is no conflict. */
export const conflictSection = (base: string, conflicts: readonly string[]): string => {
  if (conflicts.length === 0) return "";
  return [
    "# CONFLICT WITH " + base.toUpperCase(),
    "",
    `This branch conflicts with \`${base}\` and cannot merge until that is resolved. Conflicting:`,
    "",
    ...conflicts.map((c) => `- ${c}`),
    "",
    `Do this first: run \`git merge ${base}\` (\`${base}\` is a local branch, no network is needed), resolve every conflict so that both \`${base}\`'s changes and this branch's survive (for a list, keep every entry from both sides in order), run the repo's typecheck and full test suite, and commit the merge. Then continue with the rest of this task; when there is nothing else to do, the merge commit is the whole task.`,
    "",
  ].join("\n");
};
