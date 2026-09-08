import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

import {
  authorAssociation,
  DEFAULT_TRUSTED_AUTHORS,
  TRUSTED_AUTHORS_VAR,
  trustPolicy,
  trustPolicyFromEnv,
} from "./trusted-authors";

test("the default trusts the repo owner and nobody else", () => {
  const policy = trustPolicy(undefined);
  assert.deepEqual([...policy.associations], [...DEFAULT_TRUSTED_AUTHORS]);
  assert.equal(policy.trusts({ association: "OWNER" }), true);
  assert.equal(policy.trusts({ association: "COLLABORATOR" }), false);
  assert.equal(policy.trusts({ association: "NONE" }), false);
});

test("an absent association reads as an outsider", () => {
  const policy = trustPolicy(undefined);
  assert.equal(policy.trusts({ association: undefined }), false);
  assert.equal(policy.trusts({ association: null }), false);
});

test("a value GitHub never sends reads as NONE, so a strange payload is an outsider", () => {
  assert.equal(authorAssociation("OWNER"), "OWNER");
  assert.equal(authorAssociation("owner"), "OWNER");
  assert.equal(authorAssociation("SOMETHING_NEW"), "NONE");
  assert.equal(authorAssociation(undefined), "NONE");
});

test("a wider list lets in everyone who could already push", () => {
  const policy = trustPolicy("OWNER, member ,collaborator");
  assert.deepEqual([...policy.associations], ["OWNER", "MEMBER", "COLLABORATOR"]);
  assert.equal(policy.trusts({ association: "MEMBER" }), true);
  assert.equal(policy.trusts({ association: "CONTRIBUTOR" }), false);
});

test("an empty or missing input falls back to the owner alone", () => {
  assert.deepEqual([...trustPolicy(undefined).associations], ["OWNER"]);
  assert.deepEqual([...trustPolicy("  , ").associations], ["OWNER"]);
});

test("a value GitHub never sends matches nothing, so a typo parks work", () => {
  const typo = trustPolicy("OWNR");
  assert.equal(typo.trusts({ association: "OWNER" }), false);
  assert.equal(typo.trusts({ association: "NONE" }), false);
});

test("the environment carries the caller's input to the run scripts", () => {
  assert.deepEqual(
    [...trustPolicyFromEnv({ TRUSTED_AUTHOR_ASSOCIATIONS: "owner,member" }).associations],
    ["OWNER", "MEMBER"],
  );
  assert.deepEqual([...trustPolicyFromEnv({}).associations], ["OWNER"]);
});

test("the factory's own login is never a stranger, whichever way the API spells it", () => {
  // GITHUB_TOKEN comments come back as author_association NONE on every repo.
  const policy = trustPolicy("OWNER");
  assert.equal(policy.trusts({ association: "NONE", login: "github-actions[bot]" }), true);
  assert.equal(policy.trusts({ association: "NONE", login: "github-actions" }), true);
  assert.equal(policy.trusts({ association: "NONE", login: "github-actions-impostor" }), false);
  assert.equal(policy.trusts({ association: "NONE", login: "stranger" }), false);
});

test("keep returns what a trusted author wrote and counts what it dropped", () => {
  const comments = [
    { association: "OWNER", body: "keep" },
    { association: "NONE", body: "drop" },
    { association: null, body: "drop too" },
    { association: "COLLABORATOR", body: "maybe" },
  ];
  const owner = trustPolicy("OWNER").keep(comments, (c) => ({ association: c.association }));
  assert.deepEqual(owner.kept.map((c) => c.body), ["keep"]);
  assert.equal(owner.dropped, 3);

  const wider = trustPolicy("OWNER,COLLABORATOR").keep(comments, (c) => ({ association: c.association }));
  assert.deepEqual(wider.kept.map((c) => c.body), ["keep", "maybe"]);
  assert.equal(wider.dropped, 2);
});

test("droppedNote names the count and the policy, and is empty when nothing was dropped", () => {
  const policy = trustPolicy("OWNER,MEMBER");
  assert.equal(policy.droppedNote(0, "comment(s) on the PR"), "");
  const note = policy.droppedNote(2, "comment(s) on the PR");
  assert.match(note, /^2 comment\(s\) on the PR from untrusted authors were dropped\./);
  assert.match(note, /OWNER, MEMBER/);
});

/**
 * The wiring a new job or a renamed input would break, in the style of
 * `dispatch/workflow-names.test.ts`: the subject is the repo's own workflow
 * files, so the tree is the fixture. The run scripts read the policy from
 * TRUSTED_AUTHOR_ASSOCIATIONS, so a workflow that runs one of them and does
 * not pass it silently falls back to OWNER whatever the target set.
 */
const workflowsDir = new URL("../../.github/workflows/", import.meta.url);

/** Every workflow whose script builds a trust policy, and the script it runs. */
const POLICY_WORKFLOWS = {
  "dispatch.yml": "dispatch/dispatch.ts",
  "agent-implement.yml": "agent-workflows/implement/implement.ts",
  "agent-review.yml": "agent-workflows/review/review.ts",
  "agent-implement-pr.yml": "agent-workflows/implement-pr/implement-pr.ts",
  "agent-audit.yml": "audit/audit.ts",
} as const;

test("every workflow that runs a policy-reading script declares and passes the input", () => {
  for (const [file, script] of Object.entries(POLICY_WORKFLOWS)) {
    const yaml = fs.readFileSync(new URL(file, workflowsDir), "utf8");
    assert.match(yaml, new RegExp(String.raw`\n {6}trusted_author_associations:`), `${file} declares the input`);
    assert.match(yaml, /\n {8}default: OWNER\b/, `${file} defaults to OWNER`);
    assert.match(
      yaml,
      new RegExp(String.raw`${TRUSTED_AUTHORS_VAR}: \$\{\{ inputs\.trusted_author_associations \}\}`),
      `${file} passes the input to its run step`,
    );
    assert.ok(yaml.includes(script), `${file} runs ${script}`);
  }
});

test("the caller template offers the input on every job that takes it", () => {
  const template = fs.readFileSync(new URL("../../templates/factory.yml", import.meta.url), "utf8");
  const offers = template.match(/trusted_author_associations:/g) ?? [];
  assert.equal(offers.length, Object.keys(POLICY_WORKFLOWS).length);
});
