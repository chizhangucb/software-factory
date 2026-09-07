import assert from "node:assert/strict";
import { test } from "node:test";

import { modelFromLabels, resolveModel, resolveRoleModel } from "./model";

test("resolveModel falls back to the workflow default without a model label", () => {
  assert.deepEqual(resolveModel("claude-sonnet-5", ["ready-for-agent"]), {
    model: "claude-sonnet-5",
    source: "default",
  });
});

test("a model label overrides the default for that run", () => {
  assert.deepEqual(
    resolveModel("claude-sonnet-5", ["agent:implement", "model:claude-opus-5"]),
    { model: "claude-opus-5", source: "label" },
  );
});

test("an empty model label is ignored", () => {
  assert.equal(modelFromLabels(["model:", "model:  "]), undefined);
});

test("the first model label wins when several are present", () => {
  assert.equal(modelFromLabels(["model:opus", "model:sonnet"]), "opus");
});

test("a model label moves the implementer only", () => {
  const labels = ["model:claude-sonnet-5"];
  assert.deepEqual(resolveRoleModel("implementer", "claude-opus-5", labels), {
    model: "claude-sonnet-5",
    source: "label",
  });
  assert.deepEqual(resolveRoleModel("reviewer", "claude-opus-5", labels), {
    model: "claude-opus-5",
    source: "default",
  });
  assert.deepEqual(resolveRoleModel("audit", "claude-fable-5-1", labels), {
    model: "claude-fable-5-1",
    source: "default",
  });
});
