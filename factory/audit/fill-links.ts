/**
 * Fill the audit's revert-PR or needs-human bodies with the URLs the
 * workflow learned after the audit ran. `tsx fill-links.ts <file>`, values
 * from AUDIT_COMMENT_URL, REVERT_PR_URL, and REVERT_FAILURE, taken verbatim
 * (see fillMissLinks); the file is rewritten in place.
 */
import * as fs from "node:fs";
import { fillMissLinks } from "./report";

const file = process.argv[2];
if (!file) {
  console.error("usage: fill-links.ts <body file>");
  process.exit(1);
}
fs.writeFileSync(
  file,
  fillMissLinks(fs.readFileSync(file, "utf8"), {
    auditCommentUrl: process.env.AUDIT_COMMENT_URL ?? "",
    revertPrUrl: process.env.REVERT_PR_URL || undefined,
    revertFailure: process.env.REVERT_FAILURE || undefined,
  }),
);
