import assert from "node:assert/strict";
import { test } from "node:test";

import { type OpenPr, prsClosing } from "./preflight";

const pr = (number: number, body: string | null): OpenPr => ({
  number,
  url: `https://github.com/o/r/pull/${number}`,
  body,
  author: { login: "someone" },
});

test("the preflight finds PRs by the same closing keywords the retry handler and reviewer use", () => {
  const prs = [
    pr(1, "Closes #12"),
    pr(2, "Closed #12 by hand"),
    pr(3, "Fix #12"),
    pr(4, "resolves: #12"),
    pr(5, "see #12"),
    pr(6, "Closes #120"),
    pr(7, null),
    pr(8, "Closes #3 and fixes #12"),
  ];
  assert.deepEqual(
    prsClosing("12", prs).map((p) => p.number),
    [1, 2, 3, 4],
    "every GitHub keyword form counts; a mention, another ticket, and a second link do not",
  );
});
