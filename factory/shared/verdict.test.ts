import assert from "node:assert/strict";
import { test } from "node:test";

import {
  boundOutput,
  parseAcceptanceCriteria,
  renderVerdictSection,
  resolveVerdict,
  upsertVerdictSection,
  verdictDescription,
} from "./verdict";

const ticketBody = `## What to build

Add a helper.

## Acceptance criteria

- [ ] \`src/clamp.js\` exports \`clamp\`
- [x] tests cover the bounds
  - [ ] a nested note that is not a criterion
* [ ] star bullets count too

## Blocked by

- [ ] #3 is not a criterion, it lives under another heading
`;

test("parseAcceptanceCriteria reads the checklist under the acceptance criteria heading", () => {
  assert.deepEqual(parseAcceptanceCriteria(ticketBody), [
    "`src/clamp.js` exports `clamp`",
    "tests cover the bounds",
    "star bullets count too",
  ]);
});

test("parseAcceptanceCriteria ignores a checklist that is not under the heading", () => {
  assert.deepEqual(parseAcceptanceCriteria("intro\n\n- [ ] one\n- [X] two\n"), []);
  assert.deepEqual(
    parseAcceptanceCriteria("## Blocked by\n\n- [ ] #3\n\n## Acceptance criteria\n\n- [ ] real\n"),
    ["real"],
  );
});

test("parseAcceptanceCriteria skips fenced code, headings and checkboxes alike", () => {
  const body = [
    "## Acceptance criteria",
    "",
    "- [ ] CLI prints help",
    "",
    "```sh",
    "# run it",
    "- [ ] phantom",
    "```",
    "",
    "- [ ] exit code is 0",
  ].join("\n");
  assert.deepEqual(parseAcceptanceCriteria(body), ["CLI prints help", "exit code is 0"]);
});

test("parseAcceptanceCriteria returns nothing for a body without a checklist", () => {
  assert.deepEqual(parseAcceptanceCriteria("just prose\n- a bullet\n"), []);
  assert.deepEqual(parseAcceptanceCriteria(""), []);
});

const criteria = ["exports clamp", "tests cover bounds", "typecheck passes"];

test("resolveVerdict passes only when the reviewer ticks every criterion", () => {
  const verdict = resolveVerdict(criteria, {
    verdict: "pass",
    criteria: [
      { index: 1, met: true, evidence: "src/clamp.js:3" },
      { index: 2, met: true, evidence: "test/clamp.test.js" },
      { index: 3, met: true, evidence: "tsc clean in test output" },
    ],
  });
  assert.equal(verdict.verdict, "pass");
  assert.deepEqual(
    verdict.criteria.map((c) => c.met),
    [true, true, true],
  );
});

test("resolveVerdict fails when any criterion is unmet, whatever the reviewer's overall word", () => {
  const verdict = resolveVerdict(criteria, {
    verdict: "pass",
    criteria: [
      { index: 1, met: true, evidence: "ok" },
      { index: 2, met: false, evidence: "no test for the upper bound" },
      { index: 3, met: true, evidence: "ok" },
    ],
  });
  assert.equal(verdict.verdict, "fail");
  assert.equal(verdict.criteria[1]?.criterion, "tests cover bounds");
});

test("resolveVerdict fails when the reviewer says fail even with every criterion ticked", () => {
  const verdict = resolveVerdict(["one"], {
    verdict: "fail",
    criteria: [{ index: 1, met: true, evidence: "ok" }],
  });
  assert.equal(verdict.verdict, "fail");
});

test("resolveVerdict treats a criterion the reviewer skipped as unmet", () => {
  const verdict = resolveVerdict(criteria, {
    verdict: "pass",
    criteria: [{ index: 1, met: true, evidence: "ok" }],
  });
  assert.equal(verdict.verdict, "fail");
  assert.equal(verdict.criteria[1]?.met, false);
  assert.match(verdict.criteria[1]?.evidence ?? "", /no verdict/i);
});

test("resolveVerdict matches entries by criterion text when the index is absent", () => {
  const verdict = resolveVerdict(criteria, {
    verdict: "pass",
    criteria: [
      { criterion: "typecheck passes", met: true, evidence: "a" },
      { criterion: "exports clamp", met: true, evidence: "b" },
      { criterion: "tests cover bounds", met: true, evidence: "c" },
    ],
  });
  assert.equal(verdict.verdict, "pass");
  assert.deepEqual(
    verdict.criteria.map((c) => c.evidence),
    ["b", "c", "a"],
  );
});

test("resolveVerdict with no criteria is a fail", () => {
  const verdict = resolveVerdict([], { verdict: "pass", criteria: [] });
  assert.equal(verdict.verdict, "fail");
  assert.equal(verdict.criteria.length, 0);
});

test("verdictDescription is short and counts criteria", () => {
  assert.equal(
    verdictDescription({
      verdict: "pass",
      criteria: [
        { criterion: "a", met: true, evidence: "" },
        { criterion: "b", met: true, evidence: "" },
      ],
    }),
    "2/2 acceptance criteria met",
  );
  assert.equal(
    verdictDescription({
      verdict: "fail",
      criteria: [
        { criterion: "a", met: true, evidence: "" },
        { criterion: "b", met: false, evidence: "" },
      ],
    }),
    "1/2 acceptance criteria met",
  );
  assert.equal(
    verdictDescription({ verdict: "fail", criteria: [] }),
    "no acceptance criteria on the ticket",
  );
});

test("renderVerdictSection is one line per criterion, ticked with evidence, inside markers", () => {
  const section = renderVerdictSection(
    {
      verdict: "fail",
      criteria: [
        { criterion: "exports clamp", met: true, evidence: "src/clamp.js:3" },
        { criterion: "tests cover bounds", met: false, evidence: "no upper bound test" },
      ],
    },
    { headSha: "abc1234def", issueNumber: "7", runUrl: "https://example/run/1" },
  );
  const lines = section.split("\n");
  assert.equal(lines[0], "<!-- factory:verdict -->");
  assert.equal(lines.at(-1), "<!-- /factory:verdict -->");
  assert.ok(section.includes("## Verdict: fail"));
  assert.ok(section.includes("- [x] exports clamp. Evidence: src/clamp.js:3"));
  assert.ok(section.includes("- [ ] tests cover bounds. Evidence: no upper bound test"));
  assert.ok(section.includes("abc1234"));
  assert.ok(section.includes("#7"));
  assert.ok(section.includes("https://example/run/1"));
});

test("renderVerdictSection keeps multi-line evidence on one line", () => {
  const section = renderVerdictSection(
    {
      verdict: "pass",
      criteria: [{ criterion: "a", met: true, evidence: "first\nsecond" }],
    },
    { headSha: "abc1234", issueNumber: "1", runUrl: "u" },
  );
  assert.ok(section.includes("- [x] a. Evidence: first second"));
});

test("upsertVerdictSection appends the section to a body without one", () => {
  const body = upsertVerdictSection("Closes #7\n\nBy the factory.", "<!-- factory:verdict -->\nS1\n<!-- /factory:verdict -->");
  assert.equal(body, "Closes #7\n\nBy the factory.\n\n<!-- factory:verdict -->\nS1\n<!-- /factory:verdict -->\n");
});

test("upsertVerdictSection replaces an existing section instead of duplicating it", () => {
  const first = upsertVerdictSection("Closes #7", "<!-- factory:verdict -->\nS1\n<!-- /factory:verdict -->");
  const second = upsertVerdictSection(first + "\ntrailing note", "<!-- factory:verdict -->\nS2\n<!-- /factory:verdict -->");
  assert.equal(second.split("<!-- factory:verdict -->").length, 2);
  assert.ok(!second.includes("S1"));
  assert.ok(second.includes("S2"));
  assert.ok(second.includes("trailing note"));
  assert.ok(second.startsWith("Closes #7"));
});

test("boundOutput keeps the head and tail of long text and marks the cut", () => {
  const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
  const bounded = boundOutput(text, { head: 40, tail: 60 });
  assert.ok(bounded.startsWith("line 0\nline 1"));
  assert.ok(bounded.endsWith("line 99"));
  assert.ok(bounded.includes("[... "));
  assert.ok(bounded.length < 200);
  assert.equal(boundOutput("short", { head: 40, tail: 60 }), "short");
});
