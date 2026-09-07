/**
 * The implement workflow's preflight: refuse a ticket that an open PR from a
 * collaborator already closes. The closing-keyword test is `linked-issue.ts`,
 * the same one the reviewer, the gate, and the retry handler use, so every
 * part of the factory agrees on which PR belongs to a ticket.
 *
 * Env: GH_REPO, GH_TOKEN, ISSUE_NUMBER, GITHUB_OUTPUT. Writes `refused` and
 * `existing_pr_url` as step outputs. Builtins only, imported with a `.ts`
 * extension: it runs on bare `node --experimental-strip-types` before the
 * engine is installed.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { linkedIssueNumber } from "../shared/linked-issue.ts";

export interface OpenPr {
  readonly number: number;
  readonly url: string;
  readonly body: string | null;
  readonly author: { readonly login: string };
}

/** The open PRs whose body links the ticket, in the order given. */
export const prsClosing = (issueNumber: string, prs: readonly OpenPr[]): OpenPr[] =>
  prs.filter((pr) => linkedIssueNumber(pr.body) === issueNumber);

/** 64 MB: a busy repo's paginated listing passed Node's 1 MB default (ENOBUFS in the reconciler, #19). */
const GH_MAX_BUFFER = 64 * 1024 * 1024;
const gh = (args: string[]): string =>
  execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: GH_MAX_BUFFER });

const isCollaborator = (repo: string, login: string): boolean => {
  try {
    gh(["api", `repos/${repo}/collaborators/${login}`, "--silent"]);
    return true;
  } catch {
    return false;
  }
};

const main = (): void => {
  const repo = process.env.GH_REPO;
  const issue = process.env.ISSUE_NUMBER;
  const outputs = process.env.GITHUB_OUTPUT;
  if (!repo || !issue || !outputs) {
    console.error("Missing GH_REPO, ISSUE_NUMBER, or GITHUB_OUTPUT.");
    process.exit(1);
  }
  const open = JSON.parse(
    gh(["pr", "list", "--repo", repo, "--state", "open", "--search", `in:body "#${issue}"`, "--json", "number,url,body,author"]),
  ) as OpenPr[];
  // Only PRs from collaborators block the agent; outside contributors do not count.
  const blocking = prsClosing(issue, open).find((pr) => isCollaborator(repo, pr.author.login));
  fs.appendFileSync(outputs, `refused=${blocking ? "true" : "false"}\nexisting_pr_url=${blocking?.url ?? ""}\n`);
  console.log(
    blocking
      ? `Refusing: ${blocking.url} by ${blocking.author.login} already closes #${issue}.`
      : `No open collaborator PR closes #${issue} (${open.length} candidate(s) mention it).`,
  );
};

if (process.argv[1] && import.meta.filename === process.argv[1]) main();
