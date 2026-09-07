import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { runWithRotation } from "../shared/accounts";
import { fail, gh, outputDir, required, sh, writeText } from "../shared/common";
import { resolveModel } from "../shared/model";
import { installFactoryPlugins } from "../shared/plugins";
import { fetchIssue, fetchParentIssue, ticketDocument } from "../shared/ticket-context";
import { withMaxTurns } from "../shared/turn-cap";

const ISSUE_NUMBER = required("ISSUE_NUMBER");
const ISSUE_TITLE = required("ISSUE_TITLE");
const BRANCH = required("BRANCH");
const IMPLEMENTER_MODEL = required("IMPLEMENTER_MODEL");
const IMPLEMENTER_MAX_TURNS = Number(required("IMPLEMENTER_MAX_TURNS"));

try {
  if (!Number.isInteger(IMPLEMENTER_MAX_TURNS) || IMPLEMENTER_MAX_TURNS < 1) {
    fail(`IMPLEMENTER_MAX_TURNS must be a positive integer, got ${process.env.IMPLEMENTER_MAX_TURNS}.`);
  }
  const repo =
    process.env.GH_REPO ??
    gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
  // Throws on an API error: a missing body must never read as an empty ticket.
  const issueContext = fetchIssue(ISSUE_NUMBER);
  const parent = fetchParentIssue(repo, ISSUE_NUMBER);
  console.log(
    parent
      ? `Parent spec: #${parent.number} ${parent.title}.`
      : "Parent spec: none, the ticket stands alone.",
  );
  const ticketFile = `ticket-${ISSUE_NUMBER}.md`;
  writeText(ticketFile, ticketDocument({ number: ISSUE_NUMBER, issueContext, parent }));

  const labels = JSON.parse(
    gh(["issue", "view", ISSUE_NUMBER, "--json", "labels", "--jq", "[.labels[].name]"]),
  ) as string[];
  const { model, source } = resolveModel(IMPLEMENTER_MODEL, labels);
  console.log(`Implementer model: ${model} (from ${source}), turn cap ${IMPLEMENTER_MAX_TURNS}.`);

  const result = await runWithRotation(`implement-${ISSUE_NUMBER}`, model, (agent, log) => {
    // Each account runs in its own config dir, so the skills the prompt
    // invokes by name go into the dir of the account this attempt uses.
    const configDir = agent.env.CLAUDE_CONFIG_DIR;
    if (!configDir) return Promise.reject(new Error("The agent has no CLAUDE_CONFIG_DIR."));
    const plugins = installFactoryPlugins(configDir);
    console.log(`Installed factory plugins into ${configDir}: ${plugins.join(", ")}.`);
    return sandcastle.run({
      name: `implement-#${ISSUE_NUMBER}`,
      agent: withMaxTurns(agent, IMPLEMENTER_MAX_TURNS),
      sandbox: noSandbox(),
      logging: log.logging,
      // The review skills run in sub-agents whose output never reaches this
      // stream, so the parent can be silent for a while. The turn cap and the
      // job timeout are the real bounds; the library's 10 minute idle default
      // would cut a long review short.
      idleTimeoutSeconds: 30 * 60,
      promptFile: path.join(import.meta.dirname, "prompt.md"),
      promptArgs: {
        ISSUE_NUMBER,
        ISSUE_TITLE,
        BRANCH,
        ISSUE_CONTEXT: issueContext,
        TICKET_FILE: path.join(outputDir(), ticketFile),
      },
    });
  });

  const commitsAhead = Number(sh("git rev-list --count main..HEAD").trim());
  if (!Number.isFinite(commitsAhead) || commitsAhead === 0) {
    fail("Agent finished but no commits were made on the branch.");
  }

  console.log(`Implementation produced ${commitsAhead} commit(s).`);
  console.log(`Commits this run: ${result.commits.length}.`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
