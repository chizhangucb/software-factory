import assert from "node:assert/strict";
import { test } from "node:test";

import { parentIssueFromGraphql, ticketDocument } from "./ticket-context";

const withParent = JSON.stringify({
  data: {
    repository: {
      issue: {
        parent: { number: 9, title: "Spec: the thing", body: "## Problem\n\nWords." },
      },
    },
  },
});

test("parentIssueFromGraphql returns the parent when the issue has one", () => {
  assert.deepEqual(parentIssueFromGraphql(withParent), {
    number: 9,
    title: "Spec: the thing",
    body: "## Problem\n\nWords.",
  });
});

test("parentIssueFromGraphql is undefined for a top-level issue or a bad payload", () => {
  const noParent = JSON.stringify({ data: { repository: { issue: { parent: null } } } });
  assert.equal(parentIssueFromGraphql(noParent), undefined);
  assert.equal(parentIssueFromGraphql(""), undefined);
  assert.equal(parentIssueFromGraphql("{}"), undefined);
});

test("ticketDocument carries the ticket and its parent spec, in that order", () => {
  const doc = ticketDocument({
    number: 3,
    issueContext: "title:\tAdd a helper\n--\nBody here",
    parent: { number: 9, title: "Spec: the thing", body: "Spec body" },
  });
  assert.match(doc, /^# Ticket #3/m);
  assert.match(doc, /Body here/);
  assert.match(doc, /^# Parent spec #9: Spec: the thing/m);
  assert.match(doc, /Spec body/);
  assert.ok(doc.indexOf("Body here") < doc.indexOf("Spec body"));
});

test("ticketDocument says so when there is no parent spec", () => {
  const doc = ticketDocument({ number: 3, issueContext: "Body", parent: undefined });
  assert.match(doc, /no parent spec/i);
});
