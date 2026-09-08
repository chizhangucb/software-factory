/**
 * A PR that conflicts with its base cannot be brought up to date by
 * GitHub's update-branch call, and no merge queue resolves conflicts either.
 * update-branch hands such a PR to the implementer (`agent:implement` on the
 * PR); this module tells the implement-PR run whether its branch conflicts
 * and renders the prompt section that asks the agent to merge the base and
 * resolve. Pure functions over `git merge-tree` output; implement-pr.ts runs
 * git.
 */

/**
 * What `git merge-tree --write-tree` reports as conflicting: file paths for
 * content conflicts, the message for other kinds.
 *
 * The exit code is the whole answer, so anything but 0 or 1 throws (#53).
 * A bad ref exits 128, a git too old for `--write-tree` 129, a killed probe
 * reports a signal and no status at all; reading any of those as "no
 * conflicts" would hand the caller a clean branch it never checked. That
 * silence is worst at the re-check after the implement-PR run, where an
 * empty list is what lets a still-conflicting branch through.
 */
export const parseMergeTreeConflicts = (input: {
  /** Exit status of `git merge-tree --write-tree <base> <head>`: 0 clean, 1 conflicts, null when a signal killed it. */
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr?: string;
  /** The signal that killed the probe, when one did. */
  readonly signal?: string | null;
}): readonly string[] => {
  if (input.status !== 0 && input.status !== 1) {
    const exitReason =
      input.status === null ? (input.signal ? `killed by ${input.signal}` : "no exit status") : `exit ${input.status}`;
    const stderr = (input.stderr ?? "").trim();
    throw new Error(
      `git merge-tree --write-tree could not probe for conflicts (${exitReason}); expected exit 0 (clean) or 1 (conflicts)` +
        (stderr ? `: ${stderr}` : ""),
    );
  }
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
    `Do this first: run \`git merge ${base}\` (\`${base}\` is a local branch, no network is needed), then invoke the skill \`mattpocock-skills:resolving-merge-conflicts\` and resolve the merge through it. Then continue with the rest of this task; when there is nothing else to do, the merge commit is the whole task.`,
    "",
  ].join("\n");
};
