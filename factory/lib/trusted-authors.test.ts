import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authorAssociation,
  DEFAULT_TRUSTED_AUTHORS,
  trustPolicy,
  trustPolicyFromEnv,
} from "./trusted-authors";

test("the default trusts the repo owner and nobody else", () => {
  const policy = trustPolicy(undefined);
  assert.deepEqual([...policy.associations], [...DEFAULT_TRUSTED_AUTHORS]);
  assert.equal(policy.trusts("OWNER"), true);
  assert.equal(policy.trusts("COLLABORATOR"), false);
  assert.equal(policy.trusts("NONE"), false);
});

test("an absent association reads as an outsider", () => {
  const policy = trustPolicy(undefined);
  assert.equal(policy.trusts(undefined), false);
  assert.equal(policy.trusts(null), false);
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
  assert.equal(policy.trusts("MEMBER"), true);
  assert.equal(policy.trusts("CONTRIBUTOR"), false);
});

test("an empty or missing input falls back to the owner alone", () => {
  assert.deepEqual([...trustPolicy(undefined).associations], ["OWNER"]);
  assert.deepEqual([...trustPolicy("  , ").associations], ["OWNER"]);
});

test("a value GitHub never sends matches nothing, so a typo parks work", () => {
  const typo = trustPolicy("OWNR");
  assert.equal(typo.trusts("OWNER"), false);
  assert.equal(typo.trusts("NONE"), false);
});

test("the environment carries the caller's input to the run scripts", () => {
  assert.deepEqual(
    [...trustPolicyFromEnv({ TRUSTED_AUTHOR_ASSOCIATIONS: "owner,member" }).associations],
    ["OWNER", "MEMBER"],
  );
  assert.deepEqual([...trustPolicyFromEnv({}).associations], ["OWNER"]);
});

test("keep returns what a trusted author wrote and counts what it dropped", () => {
  const comments = [
    { association: "OWNER", body: "keep" },
    { association: "NONE", body: "drop" },
    { association: null, body: "drop too" },
    { association: "COLLABORATOR", body: "maybe" },
  ];
  const owner = trustPolicy("OWNER").keep(comments, (c) => c.association);
  assert.deepEqual(owner.kept.map((c) => c.body), ["keep"]);
  assert.equal(owner.dropped, 3);

  const wider = trustPolicy("OWNER,COLLABORATOR").keep(comments, (c) => c.association);
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
