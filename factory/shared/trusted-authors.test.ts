import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_TRUSTED_AUTHORS,
  isTrustedAuthor,
  parseTrustedAuthors,
  trustedAuthorsFromEnv,
} from "./trusted-authors";

test("the default trusts the repo owner and nobody else", () => {
  assert.deepEqual([...DEFAULT_TRUSTED_AUTHORS], ["OWNER"]);
  assert.equal(isTrustedAuthor("OWNER"), true);
  assert.equal(isTrustedAuthor("COLLABORATOR"), false);
  assert.equal(isTrustedAuthor("NONE"), false);
});

test("an absent association reads as an outsider", () => {
  assert.equal(isTrustedAuthor(undefined), false);
  assert.equal(isTrustedAuthor(null), false);
});

test("a wider list lets in everyone who could already push", () => {
  const trusted = parseTrustedAuthors("OWNER, member ,collaborator");
  assert.deepEqual([...trusted], ["OWNER", "MEMBER", "COLLABORATOR"]);
  assert.equal(isTrustedAuthor("MEMBER", trusted), true);
  assert.equal(isTrustedAuthor("CONTRIBUTOR", trusted), false);
});

test("an empty or missing input falls back to the owner alone", () => {
  assert.deepEqual([...parseTrustedAuthors(undefined)], ["OWNER"]);
  assert.deepEqual([...parseTrustedAuthors("  , ")], ["OWNER"]);
});

test("a value GitHub never sends matches nothing, so a typo parks work", () => {
  const typo = parseTrustedAuthors("OWNR");
  assert.equal(isTrustedAuthor("OWNER", typo), false);
});

test("the environment carries the caller's input to the run scripts", () => {
  assert.deepEqual([...trustedAuthorsFromEnv({ TRUSTED_AUTHOR_ASSOCIATIONS: "owner,member" })], [
    "OWNER",
    "MEMBER",
  ]);
  assert.deepEqual([...trustedAuthorsFromEnv({})], ["OWNER"]);
});
