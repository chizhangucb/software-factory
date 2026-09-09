/**
 * The reviewer's verdict: one tick per acceptance criterion, then pass or
 * fail. Pure functions over the ticket body and the reviewer's structured
 * output; the workflow turns the result into a PR body section and a
 * `factory/verdict` commit status.
 *
 * The section's opening marker lives in `factory-pr.ts`, because a body
 * carrying it is one of the three things that make a PR a factory PR, and
 * the audit's decide job reads that module on bare strip-types.
 */
import { VERDICT_SECTION_START } from "./factory-pr.ts";

/** One reviewer judgement as it comes out of the structured output block. */
export interface CriterionJudgement {
  /** 1-based position in the ticket's checklist. */
  readonly index?: number;
  /** The criterion text, used to match when the index is absent. */
  readonly criterion?: string;
  readonly met: boolean;
  readonly evidence: string;
}

export interface ReviewerJudgement {
  readonly verdict: "pass" | "fail";
  readonly criteria: readonly CriterionJudgement[];
}

export interface CriterionResult {
  readonly criterion: string;
  readonly met: boolean;
  readonly evidence: string;
}

export interface Verdict {
  readonly verdict: "pass" | "fail";
  readonly criteria: readonly CriterionResult[];
}

const CHECKLIST_ITEM = /^[-*]\s+\[( |x|X)\]\s+(.+?)\s*$/;
const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;
const CRITERIA_HEADING = /acceptance\s+criteria/i;

/**
 * The ticket's acceptance criteria: top-level checklist items under the
 * "Acceptance criteria" heading. Fenced code is skipped. No heading means no
 * criteria; a checklist elsewhere in the body (blockers, a task list) is not
 * the test.
 */
export const parseAcceptanceCriteria = (issueBody: string): string[] => {
  const criteria: string[] = [];
  let inCriteria = false;
  let inFence = false;

  for (const line of issueBody.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = line.match(HEADING);
    if (heading) {
      inCriteria = CRITERIA_HEADING.test(heading[1] ?? "");
      continue;
    }
    const item = inCriteria ? line.match(CHECKLIST_ITEM) : null;
    if (item) criteria.push(item[2] ?? "");
  }

  return criteria;
};

const normalise = (text: string): string =>
  text.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Line the reviewer's judgements up with the ticket's checklist, one result
 * per criterion in ticket order. A criterion the reviewer did not judge is
 * unmet. The verdict is pass only when the reviewer said pass and every
 * criterion is met; no criteria is a fail, since there is nothing to tick.
 */
export const resolveVerdict = (
  criteria: readonly string[],
  judgement: ReviewerJudgement,
): Verdict => {
  const byIndex = new Map<number, CriterionJudgement>();
  const byText = new Map<string, CriterionJudgement>();
  for (const entry of judgement.criteria) {
    if (entry.index !== undefined && !byIndex.has(entry.index)) {
      byIndex.set(entry.index, entry);
    }
    if (entry.criterion && !byText.has(normalise(entry.criterion))) {
      byText.set(normalise(entry.criterion), entry);
    }
  }

  const results = criteria.map((criterion, i): CriterionResult => {
    const entry = byIndex.get(i + 1) ?? byText.get(normalise(criterion));
    if (!entry) {
      return {
        criterion,
        met: false,
        evidence: "The reviewer gave no verdict for this criterion.",
      };
    }
    return { criterion, met: entry.met, evidence: entry.evidence };
  });

  const allMet = results.length > 0 && results.every((r) => r.met);
  return {
    verdict: judgement.verdict === "pass" && allMet ? "pass" : "fail",
    criteria: results,
  };
};

/** The status description of a verdict that failed for want of criteria; the retry handler matches on it. */
export const NO_CRITERIA_DESCRIPTION = "no acceptance criteria on the ticket";

/** Short enough for a commit status description (140 chars max). */
export const verdictDescription = (verdict: Verdict): string => {
  const total = verdict.criteria.length;
  if (total === 0) return NO_CRITERIA_DESCRIPTION;
  const met = verdict.criteria.filter((c) => c.met).length;
  return `${met}/${total} acceptance criteria met`;
};

export const SECTION_START = VERDICT_SECTION_START;
export const SECTION_END = "<!-- /factory:verdict -->";

const oneLine = (text: string): string => text.replace(/\s*\n\s*/g, " ").trim();

/** The PR body section: one line per criterion, ticked or not, with evidence. */
export const renderVerdictSection = (
  verdict: Verdict,
  context: {
    readonly headSha: string;
    readonly issueNumber: string;
    readonly runUrl: string;
  },
): string => {
  const lines = [
    SECTION_START,
    `## Verdict: ${verdict.verdict}`,
    "",
    `Reviewer judged ${context.headSha.slice(0, 7)} against the acceptance criteria of #${context.issueNumber}. ${verdictDescription(verdict)}. Run: ${context.runUrl}`,
    "",
  ];
  if (verdict.criteria.length === 0) {
    lines.push("No acceptance criteria were found on the ticket, so nothing could be ticked.");
  }
  for (const c of verdict.criteria) {
    lines.push(`- [${c.met ? "x" : " "}] ${oneLine(c.criterion)}. Evidence: ${oneLine(c.evidence)}`);
  }
  lines.push(SECTION_END);
  return lines.join("\n");
};

/** Replace the verdict section in a PR body, or append one. Never duplicates. */
export const upsertVerdictSection = (body: string, section: string): string => {
  const start = body.indexOf(SECTION_START);
  const end = body.indexOf(SECTION_END, start);
  if (start !== -1 && end !== -1) {
    return (
      body.slice(0, start) + section + body.slice(end + SECTION_END.length)
    );
  }
  return `${body.replace(/\s+$/, "")}\n\n${section}\n`;
};

/** Keep the head and tail of long text so the prompt stays bounded. */
export const boundOutput = (
  text: string,
  limits: { readonly head: number; readonly tail: number },
): string => {
  if (text.length <= limits.head + limits.tail) return text;
  const cut = text.length - limits.head - limits.tail;
  return `${text.slice(0, limits.head)}\n[... ${cut} characters cut ...]\n${text.slice(text.length - limits.tail)}`;
};
