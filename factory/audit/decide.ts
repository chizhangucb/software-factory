/**
 * The audit workflow's decision step. Reads the merge facts and the counter
 * from the environment, writes the plan to GITHUB_OUTPUT. Builtins only;
 * runs on `node --experimental-strip-types` with no install.
 */
import * as fs from "node:fs";
import { planAudit } from "./plan.ts";

const env = (name: string): string => process.env[name] ?? "";

const plan = planAudit({
  audited: Number(env("AUDITED") || "0"),
  merged: env("MERGED") === "true",
  headRef: env("HEAD_REF"),
  body: env("PR_BODY_FILE") ? fs.readFileSync(env("PR_BODY_FILE"), "utf8") : "",
  limit: env("AUDIT_LIMIT") ? Number(env("AUDIT_LIMIT")) : undefined,
});

const lines = [`audit=${plan.audit}`, `next=${plan.next}`, `reason=${plan.reason}`];
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}
console.log(
  plan.audit
    ? `Audit: yes (${plan.reason}); counter ${env("AUDITED") || "0"} -> ${plan.next}.`
    : `Audit: skipped, ${plan.reason}; counter stays at ${plan.next}.`,
);
