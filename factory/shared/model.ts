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
