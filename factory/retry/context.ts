import { gh } from "../shared/common";
import { latestRetryContext, type RetryContext, retryPromptSection } from "./decide";

/**
 * What an implementer run needs to know about the previous attempt: the
 * newest retry marker comment on the ticket, or nothing on a first attempt.
 * Fetched with the job's token before the agent starts, like the ticket
 * itself. Echoed to the job log so a run's prompt input is visible there.
 */
export const fetchRetryContext = (issueNumber: string): RetryContext | undefined => {
  let bodies: string[];
  try {
    bodies = JSON.parse(
      gh(["issue", "view", issueNumber, "--json", "comments", "--jq", "[.comments[].body]"]),
    ) as string[];
  } catch (error) {
    console.log(
      `Could not read the comments of #${issueNumber}, so no retry context: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
  return latestRetryContext(bodies);
};

/** The prompt section for this run, logged in full so the run log shows what the agent was told. */
export const retrySectionForRun = (issueNumber: string | undefined): string => {
  const context = issueNumber ? fetchRetryContext(issueNumber) : undefined;
  if (!context) {
    console.log("No retry context on the ticket: first attempt.");
    return "";
  }
  const section = retryPromptSection(context);
  console.log(
    `Retry context found on #${issueNumber}: attempt ${context.attempt}, previous failure ${context.kind}, ${context.output.length} chars of failure output. Prompt section follows.\n` +
      `----- retry section -----\n${section}\n----- end retry section -----`,
  );
  return section;
};
