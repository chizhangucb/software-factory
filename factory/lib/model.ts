/**
 * Which model a run uses.
 *
 * Every role (implementer, reviewer, audit) has a default that is a workflow
 * input. A `model:<name>` label on the ticket overrides the implementer model
 * for that run only; the name after the colon is passed to the CLI as is.
 */
export const MODEL_LABEL_PREFIX = "model:";

export const modelFromLabels = (
  labels: readonly string[],
): string | undefined => {
  const hits = labels
    .filter((label) => label.startsWith(MODEL_LABEL_PREFIX))
    .map((label) => label.slice(MODEL_LABEL_PREFIX.length).trim())
    .filter((name) => name.length > 0);
  return hits[0];
};

export const resolveModel = (
  defaultModel: string,
  labels: readonly string[],
): { model: string; source: "label" | "default" } => {
  const fromLabel = modelFromLabels(labels);
  return fromLabel
    ? { model: fromLabel, source: "label" }
    : { model: defaultModel, source: "default" };
};

export type Role = "implementer" | "reviewer" | "audit";

/**
 * The model a role runs on. Each role's default is the workflow input of
 * the same name (`implementer_model`, `reviewer_model`, `audit_model`, all
 * `claude-opus-5` unless the caller sets them). A `model:<name>` label on
 * the ticket moves the implementer only: the reviewer and the audit judge
 * with the model the repo configured, never one the ticket chose.
 */
export const resolveRoleModel = (
  role: Role,
  configured: string,
  labels: readonly string[] = [],
): { model: string; source: "label" | "default" } =>
  role === "implementer"
    ? resolveModel(configured, labels)
    : { model: configured, source: "default" };
