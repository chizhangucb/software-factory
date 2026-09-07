/**
 * Where a job's usage records live: `usage.json` in OUTPUT_DIR, appended by
 * every attempt of every `runWithRotation` call in the process, and
 * `usage-<role>.md`, the comment the workflow posts on the PR (#18). Written
 * after each attempt, so a run that then fails still leaves its usage.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { outputDir } from "./common";
import { formatUsageComment, type RunUsageRecord } from "./usage";

const RECORDS_FILE = "usage.json";

export const usageCommentFile = (role: string): string => `usage-${role}.md`;

export const readUsageRecords = (dir = outputDir()): RunUsageRecord[] => {
  const file = path.join(dir, RECORDS_FILE);
  if (!fs.existsSync(file)) return [];
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(parsed) ? (parsed as RunUsageRecord[]) : [];
};

export const appendUsageRecord = (
  record: RunUsageRecord,
  context: { readonly runUrl: string; readonly dir?: string },
): RunUsageRecord[] => {
  const dir = context.dir ?? outputDir();
  fs.mkdirSync(dir, { recursive: true });
  const records = [...readUsageRecords(dir), record];
  fs.writeFileSync(path.join(dir, RECORDS_FILE), JSON.stringify(records, null, 2));
  fs.writeFileSync(
    path.join(dir, usageCommentFile(record.role)),
    `${formatUsageComment(record.role, records, { runUrl: context.runUrl })}\n`,
  );
  return records;
};
