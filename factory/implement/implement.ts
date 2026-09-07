import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { claudeAgent, fail, gh, required, safeSh, sh } from "../shared/common";
import { resolveModel } from "../shared/model";
import { createRunLog, runOrFail } from "../shared/run-log";

const ISSUE_NUMBER = required("ISSUE_NUMBER");
const ISSUE_TITLE = required("ISSUE_TITLE");
const BRANCH = required("BRANCH");
const IMPLEMENTER_MODEL = required("IMPLEMENTER_MODEL");

try {
  const issueContext =
    safeSh(`gh issue view ${ISSUE_NUMBER} --comments`) ||
    `Issue #${ISSUE_NUMBER}: ${ISSUE_TITLE}`;

  const labels = JSON.parse(
    gh(["issue", "view", ISSUE_NUMBER, "--json", "labels", "--jq", "[.labels[].name]"]),
  ) as string[];
  const { model, source } = resolveModel(IMPLEMENTER_MODEL, labels);
  console.log(`Implementer model: ${model} (from ${source}).`);

  const log = createRunLog(`implement-${ISSUE_NUMBER}`);
  const result = await runOrFail(log, () => sandcastle.run({
    name: `implement-#${ISSUE_NUMBER}`,
    agent: claudeAgent(model),
    sandbox: noSandbox(),
    logging: log.logging,
    promptFile: path.join(import.meta.dirname, "prompt.md"),
    promptArgs: {
      ISSUE_NUMBER,
      ISSUE_TITLE,
      BRANCH,
      ISSUE_CONTEXT: issueContext,
    },
  }));

  const commitsAhead = Number(sh("git rev-list --count main..HEAD").trim());
  if (!Number.isFinite(commitsAhead) || commitsAhead === 0) {
    fail("Agent finished but no commits were made on the branch.");
  }

  console.log(`Implementation produced ${commitsAhead} commit(s).`);
  console.log(`Commits this run: ${result.commits.length}.`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
