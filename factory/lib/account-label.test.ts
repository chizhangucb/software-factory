/**
 * The `CLAUDE_ACCOUNT_<n>` label names an account for the operator, and a
 * public target's Actions log is world-readable, so the workflow that
 * enumerates the accounts prints the index and never the label (#126). The
 * other half of this rule, every line the rotation loop logs, is tested in
 * `accounts.test.ts` where the loop's own fixtures live.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

const workflowsDir = new URL("../../.github/workflows/", import.meta.url);

/**
 * The four workflows that enumerate accounts before running a model. Listed
 * here rather than shared with `dispatch/workflow-names.test.ts`, which
 * happens to name the same four: that test asserts what the dispatcher can
 * reach, this one what the enumerate step prints, and neither expectation
 * should move because the other did.
 */
const AGENT_WORKFLOWS = [
  "agent-implement.yml",
  "agent-implement-pr.yml",
  "agent-review.yml",
  "agent-audit.yml",
];

/**
 * The whole `Enumerate accounts` step, from its `- name:` to the next step's.
 * The step is checked entire rather than by its one known echo, so a label
 * put back on a second line, or written as `$vars["CLAUDE_ACCOUNT_\($n)"]`
 * rather than as `.label`, is caught too.
 */
const enumerateStep = (workflow: string): string[] => {
  const lines = fs.readFileSync(new URL(workflow, workflowsDir), "utf8").split("\n");
  const start = lines.findIndex((l) => /^\s*- name: Enumerate accounts\s*$/.test(l));
  assert.ok(start >= 0, `${workflow} has no "Enumerate accounts" step`);
  const indent = lines[start].indexOf("- name:");
  const rest = lines.slice(start + 1);
  // The step ends at the first non-blank line indented no deeper than its own
  // `- name:`. That is the next step, and also the next job's key when this
  // step is the last one, so moving the step never silently widens the scan
  // to the rest of the file.
  const end = rest.findIndex((l) => l.trim() !== "" && l.search(/\S/) <= indent);
  return rest.slice(0, end === -1 ? rest.length : end);
};

/**
 * The lines of the step that print. Only these reach the job log, and the
 * list is every way the step could put the accounts file on stdout, not just
 * the `echo` it uses today: a `cat "$file"` or a `jq -r` reading it would
 * publish both the labels and the tokens.
 */
const printing = (step: string[]): string[] =>
  step.filter((line) => /\b(echo|printf|cat|tee)\b/.test(line) || /\bjq\b[^|]*"\$file"/.test(line));

test("the Enumerate accounts step logs the account index and not the label", () => {
  for (const workflow of AGENT_WORKFLOWS) {
    const step = enumerateStep(workflow);
    const printed = printing(step);
    assert.ok(
      printed.some((line) => line.includes("account(s) configured") && line.includes(".index")),
      `${workflow} must log the account index: ${printed.join("\n")}`,
    );
    for (const line of printed) {
      assert.doesNotMatch(
        line,
        /\.label|CLAUDE_ACCOUNT_/,
        `${workflow} prints the CLAUDE_ACCOUNT_<n> label, which a public target publishes: ${line}`,
      );
    }
    // The step still reads the variable: it belongs in the on-runner accounts
    // file, which is where the label may live. Only printing it is the leak.
    // Comment lines do not count, or the step's own `# ... CLAUDE_ACCOUNT_<n>
    // variable` header would satisfy this on its own and the check would still
    // pass with the jq that populates `label` deleted, which silently leaves
    // usage.json naming every account `account-<n>`.
    assert.ok(
      step.some((line) => !/^\s*#/.test(line) && line.includes("CLAUDE_ACCOUNT_")),
      `${workflow} no longer reads CLAUDE_ACCOUNT_<n> into the accounts file at all`,
    );
  }
});
