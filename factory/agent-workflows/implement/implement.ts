/**
 * Vendored from sandcastle 0.12.0, `.sandcastle/agent-workflows/implement/implement.ts`.
 * His shape stands: read the issue, `sandcastle.run()` the prompt file, fail
 * when the agent made no commits. Every line that differs is forced, and each
 * is named here (#47 keeps this list true):
 *
 * - account rotation, one config dir per account: stories 15, 16, 17, ADR 0004.
 * - model as a workflow input plus a `model:` label override: story 20.
 * - ticket document, parent spec and `ticket-N.md`: stories 22, 23.
 * - trusted authors over the ticket, its comments, the parent and the retry
 *   marker: ADR 0002 amendment.
 * - retry section in the prompt: stories 12, 13.
 * - factory plugins installed per attempt, so the prompt's skills exist: story 4.
 * - commits counted on `refs/heads/$BRANCH` against main, not on HEAD: a retry
 *   that inherits the last attempt's commits still has a branch to judge (#16).
 * - `prompt.md` keeps his sections (TASK, ISSUE, CONTEXT, EXECUTION, COMMIT);
 *   the paragraphs inside them are the factory's (stories 4, 7, 8, 23).
 */
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { runWithRotation } from "../../lib/accounts";
import { fail, gh, outputDir, required, sh, writeText } from "../shared/common";
import { resolveRoleModel } from "../../lib/model";
import { installFactoryPlugins } from "../../lib/plugins";
import { fetchIssue, fetchParentIssue, ticketDocument } from "../../lib/ticket-context";
import { trustedAuthorsFromEnv } from "../../lib/trusted-authors";
import { retrySectionForRun } from "../../retry/context";

const ISSUE_NUMBER = required("ISSUE_NUMBER");
const ISSUE_TITLE = required("ISSUE_TITLE");
const BRANCH = required("BRANCH");
const IMPLEMENTER_MODEL = required("IMPLEMENTER_MODEL");

try {
  const repo =
    process.env.GH_REPO ??
    gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
  // Whose words this run acts on (ADR 0002 amendment). One list for the ticket,
  // its comments, its parent spec, and the retry marker.
  const trustedAuthors = trustedAuthorsFromEnv();
  console.log(`Trusted authors: ${trustedAuthors.join(", ")}.`);
  // Throws on an API error: a missing body must never read as an empty ticket.
  const issueContext = fetchIssue(ISSUE_NUMBER, trustedAuthors);
  const parent = fetchParentIssue(repo, ISSUE_NUMBER);
  console.log(
    parent
      ? `Parent spec: #${parent.number} ${parent.title} (${parent.authorAssociation}).`
      : "Parent spec: none, the ticket stands alone.",
  );
  const ticketFile = `ticket-${ISSUE_NUMBER}.md`;
  writeText(
    ticketFile,
    ticketDocument({ number: ISSUE_NUMBER, issueContext, parent, trustedAuthors }),
  );
  // A retry (#16) runs on the same branch with the previous failure in its prompt.
  const retrySection = retrySectionForRun(ISSUE_NUMBER, trustedAuthors);

  const labels = JSON.parse(
    gh(["issue", "view", ISSUE_NUMBER, "--json", "labels", "--jq", "[.labels[].name]"]),
  ) as string[];
  const { model, source } = resolveRoleModel("implementer", IMPLEMENTER_MODEL, labels);
  console.log(`Implementer model: ${model} (from ${source}).`);

  const result = await runWithRotation(`implement-${ISSUE_NUMBER}`, model, (agent, log) => {
    // Each account runs in its own config dir, so the skills the prompt
    // invokes by name go into the dir of the account this attempt uses.
    const configDir = agent.env.CLAUDE_CONFIG_DIR;
    if (!configDir) return Promise.reject(new Error("The agent has no CLAUDE_CONFIG_DIR."));
    const plugins = installFactoryPlugins(configDir);
    console.log(`Installed factory plugins into ${configDir}: ${plugins.join(", ")}.`);
    return sandcastle.run({
      name: `implement-#${ISSUE_NUMBER}`,
      agent,
      sandbox: noSandbox(),
      logging: log.logging,
      // The review skills run in sub-agents whose output never reaches this
      // stream, so the parent can be silent for a while. The 60 minute job
      // timeout is the only bound on the run; the library's 10 minute idle
      // default would cut a long review short.
      idleTimeoutSeconds: 30 * 60,
      promptFile: path.join(import.meta.dirname, "prompt.md"),
      promptArgs: {
        ISSUE_NUMBER,
        ISSUE_TITLE,
        BRANCH,
        ISSUE_CONTEXT: issueContext,
        TICKET_FILE: path.join(outputDir(), ticketFile),
        RETRY_SECTION: retrySection,
      },
    });
  }, { role: "implementer" });

  // Against main, not this run's start: a retry that inherits the previous
  // attempt's commits and rightly changes nothing still has a branch to judge.
  // On the branch by name, which is what the workflow pushes, not on HEAD.
  const commitsAhead = Number(sh(`git rev-list --count "main..refs/heads/${BRANCH}"`).trim());
  if (!Number.isFinite(commitsAhead) || commitsAhead === 0) {
    fail("Agent finished but no commits were made on the branch.");
  }

  console.log(`Implementation produced ${commitsAhead} commit(s) ahead of main.`);
  console.log(`Commits this run: ${result.commits.length}.`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
