import * as fs from "node:fs";
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import {
  claudeAgent,
  fail,
  required,
  sh,
  writeJson,
  writeText,
} from "../shared/common";
import { fetchPullRequestContext } from "../shared/review-context";
import {
  filterInlineComments,
  filterReplies,
  reviewOutputSchema,
} from "../shared/review-output";
import { runWithExtraction } from "../shared/run-with-extraction";
import { createRunLog, runOrFail } from "../shared/run-log";
import {
  boundOutput,
  parseAcceptanceCriteria,
  renderVerdictSection,
  resolveVerdict,
  upsertVerdictSection,
  verdictDescription,
  type Verdict,
} from "../shared/verdict";

const PR_NUMBER = required("PR_NUMBER");
const BRANCH = required("BRANCH");
const BRANCH_HEAD_SHA = required("BRANCH_HEAD_SHA");
const REVIEWER_MODEL = required("REVIEWER_MODEL");
const RUN_URL = required("RUN_URL");
/** Captured by the workflow before this script runs; absent means no tests ran. */
const TEST_OUTPUT_FILE = process.env.TEST_OUTPUT_FILE;

const TEST_OUTPUT_LIMITS = { head: 4_000, tail: 12_000 };

/**
 * The reviewer is read-only. It judges the head sha the workflow labeled;
 * any commit, any dirty file, or any moved HEAD fails the run before a
 * verdict is written, so nothing the reviewer touched can reach the branch.
 */
const assertBranchUntouched = (commits: number): void => {
  const head = sh("git rev-parse HEAD").trim();
  if (commits > 0 || head !== BRANCH_HEAD_SHA) {
    fail(
      `Reviewer must not commit: ${commits} commit(s) made, HEAD ${head.slice(0, 7)} vs reviewed ${BRANCH_HEAD_SHA.slice(0, 7)}.`,
    );
  }
  const dirty = sh("git status --porcelain")
    .split("\n")
    .filter((line) => line.trim().length > 0 && !line.includes(".sandcastle/"));
  if (dirty.length > 0) {
    fail(`Reviewer must not edit files: ${dirty.join("; ")}`);
  }
};

const writeVerdict = (
  verdict: Verdict,
  prBody: string,
  issueNumber: string,
): void => {
  const section = renderVerdictSection(verdict, {
    headSha: BRANCH_HEAD_SHA,
    issueNumber: issueNumber || "(none)",
    runUrl: RUN_URL,
  });
  writeText("verdict.txt", verdict.verdict === "pass" ? "success" : "failure");
  writeText("verdict-description.txt", verdictDescription(verdict));
  writeText("verdict-section.md", section);
  writeText("pr_body.md", upsertVerdictSection(prBody, section));
  writeJson("verdict.json", verdict);
  console.log(`Verdict: ${verdict.verdict} (${verdictDescription(verdict)}).`);
};

try {
  const context = fetchPullRequestContext(PR_NUMBER);
  const criteria = parseAcceptanceCriteria(context.issueBody);
  console.log(`Reviewer model: ${REVIEWER_MODEL}.`);
  console.log(
    `Ticket #${context.issueNumber || "(none)"}: ${criteria.length} acceptance criteria.`,
  );

  if (criteria.length === 0) {
    // Nothing to tick, so no reviewer run: the verdict is a mechanical fail.
    const reason = context.issueNumber
      ? `#${context.issueNumber} has no acceptance criteria checklist.`
      : "The PR body links no ticket (no `Closes #N`).";
    writeVerdict(
      resolveVerdict([], { verdict: "fail", criteria: [] }),
      context.prBody,
      context.issueNumber,
    );
    writeJson("review_payload.json", {
      commit_id: BRANCH_HEAD_SHA,
      event: "COMMENT",
      body: `Verdict: fail. ${reason} The reviewer ticks acceptance criteria; without them there is nothing to judge.`,
      comments: [],
    });
    writeJson("replies.json", []);
    console.log(reason);
  } else {
    const testOutput =
      TEST_OUTPUT_FILE && fs.existsSync(TEST_OUTPUT_FILE)
        ? boundOutput(fs.readFileSync(TEST_OUTPUT_FILE, "utf8"), TEST_OUTPUT_LIMITS)
        : "(no test output was captured)";

    const log = createRunLog(`review-${PR_NUMBER}`);
    const result = await runOrFail(log, () =>
      runWithExtraction({
        name: `review-pr-${PR_NUMBER}`,
        agent: claudeAgent(REVIEWER_MODEL),
        sandbox: noSandbox(),
        logging: log.logging,
        promptFile: path.join(import.meta.dirname, "prompt.md"),
        promptArgs: {
          PR_NUMBER,
          BRANCH,
          PR_TITLE: context.prTitle,
          ISSUE_NUMBER: context.issueNumber,
          ISSUE_TITLE: context.issueTitle,
          ACCEPTANCE_CRITERIA: criteria
            .map((text, i) => `${i + 1}. ${text}`)
            .join("\n"),
          LINKED_ISSUE: context.linkedIssue,
          DIFF_TO_MAIN: context.diff,
          TEST_OUTPUT: testOutput,
          PR_COMMENTS_JSON: context.prCommentsJson,
        },
        output: sandcastle.Output.object({
          tag: "output",
          schema: reviewOutputSchema,
        }),
        extractionPrompt: fs.readFileSync(
          path.join(import.meta.dirname, "extraction.md"),
          "utf8",
        ),
      }),
    );

    assertBranchUntouched(result.commits.length);

    const verdict = resolveVerdict(criteria, result.output);
    writeVerdict(verdict, context.prBody, context.issueNumber);

    const validInlineComments = filterInlineComments(
      result.output.inlineComments,
      context.diffLines,
    );
    const validReplies = filterReplies(
      result.output.replies,
      context.validReplyIds,
    );
    writeJson("review_payload.json", {
      commit_id: BRANCH_HEAD_SHA,
      event: "COMMENT",
      body: `Verdict: ${verdict.verdict} (${verdictDescription(verdict)}).\n\n${result.output.summary}`,
      comments: validInlineComments.map((comment) => ({
        path: comment.path,
        line: comment.line,
        side: "RIGHT",
        body: comment.body,
      })),
    });
    writeJson("replies.json", validReplies);
    writeText("summary.md", result.output.summary);

    console.log("Review complete.");
    console.log(`Inline comments: ${validInlineComments.length}.`);
    console.log(`Replies: ${validReplies.length}.`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
