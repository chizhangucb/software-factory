/**
 * Vendored from sandcastle 0.12.0, `.sandcastle/agent-workflows/shared/common.ts`.
 * Forced differences, each named (#47):
 *
 * - `claudeAgent()` takes the model and the account instead of hardcoding
 *   `claude-opus-4-8` and one token: stories 17, 20, ADR 0004. See its own doc.
 * - `gh` re-exports `lib/gh.ts`, one wrapper and one 64 MB buffer (#19).
 *
 * `errorMessage` was here and was not forced by anything; it now lives in
 * `lib/errors.ts` with its factory-authored callers.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import * as sandcastle from "@ai-hero/sandcastle";

export const outputDir = (): string => process.env.OUTPUT_DIR ?? "/tmp";

export const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
};

export const fail = (message: string): never => {
  console.error(`\nFAILED: ${message}`);
  fs.mkdirSync(outputDir(), { recursive: true });
  fs.writeFileSync(path.join(outputDir(), "failure_reason.txt"), message);
  process.exit(1);
};

export const sh = (cmd: string): string =>
  execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

export const safeSh = (cmd: string): string => {
  try {
    return sh(cmd);
  } catch {
    return "";
  }
};

// #47: his four-line wrapper now re-exports the factory's one gh wrapper, which
// carries the 64 MB buffer a busy repo's listing needs (ENOBUFS, #19).
export { gh } from "../../lib/gh";

export const writeJson = (filename: string, value: unknown): void => {
  fs.mkdirSync(outputDir(), { recursive: true });
  fs.writeFileSync(
    path.join(outputDir(), filename),
    JSON.stringify(value, null, 2),
  );
};

export const writeText = (filename: string, value: string): void => {
  fs.mkdirSync(outputDir(), { recursive: true });
  fs.writeFileSync(path.join(outputDir(), filename), value);
};

/**
 * The factory's Claude provider. The model is a workflow input resolved by
 * the calling script (see `model.ts`); the token comes from the account the
 * script picked (`accounts.ts`), or from CLAUDE_CODE_OAUTH_TOKEN when none is
 * given. Each account gets its own config dir so tokens never share state,
 * and sandcastle is told to look for sessions under that dir, since resume
 * (used by review extraction) otherwise searches $HOME. API-key vars are
 * blanked so a stray key can never outrank the subscription token (ADR
 * 0001). The agent gets no GitHub credentials: the scripts fetch context
 * before the run, and the workflow alone pushes, labels, and opens PRs.
 */
export const claudeConfigDir = (account?: number): string => {
  const base =
    process.env.CLAUDE_CONFIG_DIR ?? path.join(outputDir(), "claude-config");
  return account === undefined ? base : `${base}-${account}`;
};

export interface AgentAccount {
  readonly index: number;
  readonly token: string;
}

export const claudeAgent = (model: string, account?: AgentAccount) => {
  const configDir = claudeConfigDir(account?.index);
  return sandcastle.claudeCode(model, {
    env: {
      CLAUDE_CODE_OAUTH_TOKEN: account?.token ?? required("CLAUDE_CODE_OAUTH_TOKEN"),
      CLAUDE_CONFIG_DIR: configDir,
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
    },
    sessionStorage: {
      hostProjectsDir: path.join(configDir, "projects"),
    },
  });
};

export const standardSchema = <T>(
  validate: (value: unknown) => T,
): StandardSchemaV1<unknown, T> => ({
  "~standard": {
    version: 1,
    vendor: "sandcastle-agent-workflows",
    validate: (value: unknown) => {
      try {
        return { value: validate(value) };
      } catch (error) {
        return {
          issues: [
            {
              message:
                error instanceof Error ? error.message : "Validation failed",
            },
          ],
        };
      }
    },
  },
});

export const asRecord = (
  value: unknown,
  label: string,
): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

export const asString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

export const asOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

export const asArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
};
