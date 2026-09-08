/**
 * Vendored from sandcastle 0.12.0, `.sandcastle/agent-workflows/implement-pr/implement-pr.ts`.
 * His flow is intact: PR context, one run over the unresolved threads, replies
 * and comments out, refuse to finish with nothing to show. Every line that
 * differs is forced, and each is named here (#47 keeps this list true):
 *
 * - conflict hand-off: update-branch labels a conflicting PR `agent:implement`, so
 *   this run probes with `git merge-tree`, asks the agent to merge and resolve, and
 *   fails if the conflict survives, or the hand-off would loop (#19). A probe that
 *   neither exited 0 nor 1 fails the run too, naming the exit, rather than reading
 *   its own crash as resolved (#53). His own `update-branch` agent does this
 *   upstream; kept as built because the proof run exercised it (story 5 of #46).
 * - retry section in the prompt: stories 12, 13.
 * - factory plugins installed per attempt, so the conflict section's
 *   `mattpocock-skills:resolving-merge-conflicts` exists: story 12 of #46. The
 *   whole plugin goes in, so TASK fences the run to the skills the prompt names:
 *   the other 24 are in the list and some of them describe work this run is not
 *   doing (story 11 of #46).
 * - trusted authors over the PR comments, the review threads, the linked issue
 *   with its comments, and the retry marker: story 27, ADR 0002 amendment.
 * - account rotation: stories 15, 16, 17, ADR 0004. Model as an input: story 20.
 * - `prompt.md` is his, plus: the CONFLICT and RETRY placeholders and the line
 *   that sends the agent at the conflict first (#19); the no-credentials line
 *   (the agent gets no GitHub token, ADR 0002); and his `npm run typecheck`
 *   line widened to the repo's own typecheck and full suite, with what the gate
 *   re-checks on a retry push, since nothing here is specific to one repo
 *   (story 23) and the gate is the factory's, not his (stories 7, 8, 9, #13).
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { runWithRotation } from "../../lib/accounts";
import {
  fail,
  gh,
  required,
  writeJson,
  writeText,
} from "../shared/common";
import { resolveRoleModel } from "../../lib/model";
import { installPluginsForAttempt } from "../../lib/plugins";
import { describeDropped, fetchPullRequestContext } from "../shared/review-context";
import { trustPolicyFromEnv } from "../../lib/trusted-authors";
import {
  filterInlineComments,
  filterReplies,
  implementPrOutputSchema,
} from "../shared/review-output";
import { runWithExtraction } from "../shared/run-with-extraction";
import { retrySectionForRun } from "../../retry/context";
import { conflictSection, parseMergeTreeConflicts } from "../../lib/conflicts";

const PR_NUMBER = required("PR_NUMBER");
const BRANCH = required("BRANCH");
const IMPLEMENTER_MODEL = required("IMPLEMENTER_MODEL");
/** The base branch, present as a local branch (the workflow runs `git branch -f main origin/main`). */
const BASE_BRANCH = process.env.BASE_BRANCH || "main";

/**
 * Whether this branch conflicts with the base: update-branch hands such PRs to
 * this run. A probe that neither exited 0 nor 1 throws, so the run fails with
 * the exit in the reason rather than reporting a branch it never checked (#53).
 */
const detectConflicts = (): readonly string[] => {
  const probe = spawnSync("git", ["merge-tree", "--write-tree", BASE_BRANCH, "HEAD"], { encoding: "utf8" });
  // The spawn itself failing (no git on PATH) is not a probe result to read.
  if (probe.error) throw probe.error;
  return parseMergeTreeConflicts({
    status: probe.status,
    stdout: probe.stdout,
    stderr: probe.stderr,
    signal: probe.signal,
  });
};

try {
  // Whose words this run reads (story 27, ADR 0002 amendment): built once here
  // and passed to the PR context and the retry marker alike, so both follow the
  // target's own policy rather than a default of their own.
  const policy = trustPolicyFromEnv();
  console.log(`Trusted authors: ${policy.associations.join(", ")}.`);
  const context = fetchPullRequestContext(PR_NUMBER, policy);
  console.log(describeDropped(context.dropped));

  const labels = JSON.parse(
    gh(["pr", "view", PR_NUMBER, "--json", "labels", "--jq", "[.labels[].name]"]),
  ) as string[];
  const { model, source } = resolveRoleModel("implementer", IMPLEMENTER_MODEL, labels);
  console.log(`Implementer model: ${model} (from ${source}).`);
  // A retry (#16) carries the failing verdict or check log on the linked ticket.
  const retrySection = retrySectionForRun(context.issueNumber || undefined, policy);
  const conflicts = detectConflicts();
  console.log(
    conflicts.length === 0
      ? `No conflict with ${BASE_BRANCH}.`
      : `Conflicts with ${BASE_BRANCH} (${conflicts.join(", ")}): the prompt asks the agent to merge and resolve first.`,
  );

  const result = await runWithRotation(`implement-pr-${PR_NUMBER}`, model, (agent, log) => {
    // Each account runs in its own config dir, so the skills the prompt
    // invokes by name go into the dir of the account this attempt uses.
    installPluginsForAttempt(agent.env.CLAUDE_CONFIG_DIR);
    return runWithExtraction({
      name: `implement-pr-${PR_NUMBER}`,
      agent,
      sandbox: noSandbox(),
      logging: log.logging,
      promptFile: path.join(import.meta.dirname, "prompt.md"),
      promptArgs: {
        PR_NUMBER,
        BRANCH,
        PR_TITLE: context.prTitle,
        ISSUE_NUMBER: context.issueNumber || "(none)",
        ISSUE_TITLE: context.issueTitle || "(no linked issue)",
        LINKED_ISSUE: context.linkedIssue,
        DIFF_TO_MAIN: context.diff,
        PR_COMMENTS_JSON: context.prCommentsJson,
        RETRY_SECTION: retrySection,
        CONFLICT_SECTION: conflictSection(BASE_BRANCH, conflicts),
      },
      output: sandcastle.Output.object({
        tag: "output",
        schema: implementPrOutputSchema,
      }),
      extractionPrompt: fs.readFileSync(
        path.join(import.meta.dirname, "extraction.md"),
        "utf8",
      ),
    });
  }, { role: "implementer" });

  const threadReplies = filterReplies(
    result.output.threadReplies,
    context.validReplyIds,
  );
  const newInlineComments = filterInlineComments(
    result.output.newInlineComments,
    context.diffLines,
  );
  const hasCommits = result.commits.length > 0;

  // A conflict the agent left in place must fail the run, or the hand-off would loop:
  // review passes the unchanged head, update-branch conflicts again, hands off again.
  if (conflicts.length > 0) {
    const remaining = detectConflicts();
    if (remaining.length > 0) {
      fail(`Branch still conflicts with ${BASE_BRANCH} after the run (${remaining.join(", ")}); the merge was not resolved.`);
    }
    console.log(`Conflict with ${BASE_BRANCH} resolved on the branch.`);
  }

  if (
    !hasCommits &&
    threadReplies.length === 0 &&
    newInlineComments.length === 0 &&
    result.output.topLevelComments.length === 0
  ) {
    fail("Agent finished but made no commits and emitted no comments.");
  }

  writeText("has_commits.txt", hasCommits ? "true" : "false");
  writeJson("implement_thread_replies.json", threadReplies);
  writeJson("implement_new_inline_comments.json", newInlineComments);
  writeJson(
    "implement_top_level_comments.json",
    result.output.topLevelComments,
  );

  console.log("Implement PR complete.");
  console.log(`Commits: ${result.commits.length}.`);
  console.log(`Thread replies: ${threadReplies.length}.`);
  console.log(`Inline comments: ${newInlineComments.length}.`);
  console.log(`Top-level comments: ${result.output.topLevelComments.length}.`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
