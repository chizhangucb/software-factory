/**
 * The audit workflow's decision step. Reads the merge facts and the counter
 * from the environment, writes the plan to GITHUB_OUTPUT. Builtins only;
 * runs on `node --experimental-strip-types` with no install.
 *
 * The limit goes out as an output too (#121). `AUDIT_LIMIT` in plan.ts is the
 * one place 20 is written, and no workflow file carries the number, so the two
 * steps that print "of the first N" read it from this job: the audit runner
 * through its `AUDIT_LIMIT` env, and the bash step that reports a failed run,
 * which cannot import a TypeScript constant. Nothing passes a limit in, so the
 * constant is what `planAudit` applies and what is published here.
 */
import * as fs from "node:fs";
import { AUDIT_LIMIT, planAudit } from "./plan.ts";

const env = (name: string): string => process.env[name] ?? "";

const plan = planAudit({
  audited: Number(env("AUDITED") || "0"),
  merged: env("MERGED") === "true",
  headRef: env("HEAD_REF"),
  body: env("PR_BODY_FILE") ? fs.readFileSync(env("PR_BODY_FILE"), "utf8") : "",
});

const lines = [
  `audit=${plan.audit}`,
  `next=${plan.next}`,
  `limit=${AUDIT_LIMIT}`,
  `reason=${plan.reason}`,
];
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}
console.log(
  plan.audit
    ? `Audit: yes (${plan.reason}); counter ${env("AUDITED") || "0"} -> ${plan.next}.`
    : `Audit: skipped, ${plan.reason}; counter stays at ${plan.next}.`,
);
