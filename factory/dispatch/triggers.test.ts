/**
 * Which events reach the caller's jobs, and what each job's condition does with
 * them. The subject is `templates/factory.yml`, so the file is the fixture: a
 * target's caller is the only place the trigger list and the job conditions
 * exist, and neither is reachable from a unit test of the selection module.
 *
 * Widening the issue trigger set widens it for every job in the file, not just
 * the dispatcher, so every job's condition is evaluated against every issue
 * event the caller subscribes to. Removing `agent:implement` must not start an
 * implementer, and `unassigned` must not wake anything but the dispatcher.
 *
 * The conditions are evaluated rather than pattern-matched, because the bug
 * this guards against is a silent one. An `unassigned` payload carries no
 * `label`, so a clause that reads `github.event.label.name` without first
 * saying which action it is for reads null, compares false, and drops the event
 * with no error anywhere. `evaluate` below therefore throws on a dereference
 * GitHub would answer with null, which turns that silence into a failing test.
 *
 * The evaluator understands the subset the caller's conditions are written in:
 * `github.*` paths, single-quoted strings, `==`, `!=`, `!`, `&&`, `||`, parens,
 * and the functions in `FUNCTIONS`. A condition that outgrows it fails loudly
 * here rather than being waved through.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

const template = fs.readFileSync(new URL("../../templates/factory.yml", import.meta.url), "utf8");

/** Every job in the caller, by id, with its `if:` folded to one line. A job without one is absent. */
const conditions = new Map(
  [...template.matchAll(/\n {2}([a-z][a-z0-9_-]*):\n {4}if:((?:.*)(?:\n {6,}.*)*)/g)].map(([, id, expression]) => [
    id!,
    expression!.replace(/^\s*(?:>-|>|\|-|\|)/, "").replace(/\s+/g, " ").trim(),
  ]),
);

/** The event types an `on:` block subscribes to, as a sorted list. */
const typesOf = (yaml: string, event: string): string[] => {
  const types = yaml.match(new RegExp(String.raw`\n  ${event}:\n(?: {4}(?:#.*)?\n?)*    types: \[([^\]]*)\]`));
  assert.ok(types, `the caller template subscribes to ${event} with a flow list of types`);
  return types[1]!.split(",").map((type) => type.trim()).sort();
};

/** A webhook payload as a condition sees it: whatever GitHub sends, and nothing else. */
type Context = { event_name: string; event?: Record<string, unknown> };

/**
 * The GitHub expression functions a caller condition may call, each answering
 * as GitHub's does. A bare identifier that is neither `read` nor a name in
 * here fails the test below rather than reaching `new Function` as a
 * ReferenceError, so the evaluator still refuses what it cannot answer.
 */
const FUNCTIONS: Record<string, (...args: unknown[]) => unknown> = {
  startsWith: (value, prefix) => String(value).startsWith(String(prefix)),
};

/**
 * Answer a condition as GitHub would, except that reading through an absent
 * field throws instead of returning null. That is the whole point: a condition
 * must say which action each of its clauses is for.
 */
const evaluate = (expression: string, context: Context): boolean => {
  const read = (path: string): unknown => {
    let value: unknown = context;
    for (const key of path.split(".")) {
      if (value === null || typeof value !== "object") {
        throw new Error(`the condition read ${path}, and this payload has no ${key}`);
      }
      value = (value as Record<string, unknown>)[key];
    }
    return value ?? null;
  };
  const js = expression
    .replace(/github\.([a-z_]+(?:\.[a-z_]+)*)/gi, (_, path: string) => `read(${JSON.stringify(path)})`)
    .replace(/'([^']*)'/g, (_, literal: string) => JSON.stringify(literal));
  const bare = js.replace(/"[^"]*"/g, '""');
  assert.doesNotMatch(bare, /[^\s\w".,()!=&|]/, `the condition uses syntax this test cannot evaluate: ${expression}`);
  for (const name of bare.match(/[A-Za-z_]\w*/g) ?? []) {
    assert.ok(
      name === "read" || Object.hasOwn(FUNCTIONS, name),
      `the condition calls ${name}, which this test cannot evaluate: ${expression}`,
    );
  }
  const functions = Object.entries(FUNCTIONS);
  return Boolean(
    new Function("read", ...functions.map(([name]) => name), `return (${js});`)(
      read,
      ...functions.map(([, fn]) => fn),
    ),
  );
};

const issueEvent = (action: string, label?: string): Context => ({
  event_name: "issues",
  event: label === undefined ? { action } : { action, label: { name: label } },
});

/**
 * Every issue event the caller subscribes to, and the jobs it should wake.
 *
 * An `unlabeled` event wakes the dispatcher for any label outside the
 * factory's own two namespaces, and `unassigned` wakes it whoever dropped the
 * assignee. Which of the admitted removals can actually unblock a ticket is
 * still select.ts's answer and not the caller's, so a sweep over a ticket
 * nothing unblocked labels nothing.
 *
 * The namespace clauses are not a refinement of that rule, they are a loop
 * breaker (#170). The factory writes every label with FACTORY_PAT so the
 * write fires its event, and that cuts both ways: its own removals woke a
 * sweep too. This file used to say that removing `agent:implement` is how the
 * reconciler re-fires a stranded ticket and so must reach the dispatcher. It
 * had the mechanism backwards. The reconciler removes the label and adds it
 * straight back itself, and it is the *add* that starts the run; the removal
 * reaching the dispatcher only ever added a second, racing dispatcher, which
 * found the ticket takeable in the gap between the two writes. That is what
 * turned a cancelled run into a replacement within seconds. A ticket left in
 * a factory state label with no live run is picked up by the reconciler at
 * its stuck deadline instead, on the next heartbeat.
 */
const ISSUE_EVENTS: { action: string; label?: string; wakes: string[] }[] = [
  { action: "labeled", label: "ready-for-agent", wakes: ["dispatch"] },
  { action: "labeled", label: "agent:implement", wakes: ["implement"] },
  { action: "labeled", label: "documentation", wakes: [] },
  { action: "unlabeled", label: "ready-for-human", wakes: ["dispatch"] },
  { action: "unlabeled", label: "needs-triage", wakes: ["dispatch"] },
  // The documented hand-back of an escalated ticket: a human takes needs-human
  // off and puts ready-for-agent back. Neither write is the factory's, and both
  // reach the dispatcher.
  { action: "unlabeled", label: "needs-human", wakes: ["dispatch"] },
  { action: "unlabeled", label: "ready-for-agent", wakes: ["dispatch"] },
  { action: "unlabeled", label: "agent:implement", wakes: [] },
  { action: "unlabeled", label: "agent:in-progress", wakes: [] },
  { action: "unlabeled", label: "factory:retry-1", wakes: [] },
  { action: "unassigned", wakes: ["dispatch"] },
  { action: "closed", wakes: ["dispatch"] },
];

/**
 * Every site outside the caller that names the trigger set in the caller's own
 * bracket form. None is reachable from the caller, so a trigger added to the
 * template leaves each of them telling a reader the dispatcher runs on less
 * than it does.
 */
const TRIGGER_SET_SITES = ["docs/pipeline.md", ".github/workflows/dispatch.yml", "factory/dispatch/dispatch.ts"];

test("the caller subscribes to exactly the issue events its conditions answer", () => {
  const subscribed = typesOf(template, "issues");
  assert.deepEqual(subscribed, ["closed", "labeled", "unassigned", "unlabeled"]);
  // Neither half is any use alone: a type nobody answers is a run that does
  // nothing, and a clause for a type nobody subscribes to never fires.
  assert.deepEqual([...new Set(ISSUE_EVENTS.map((event) => event.action))].sort(), subscribed);
});

test("pull_request_target stays on labeled alone, because its jobs read a label with no action clause", () => {
  // `review` and `implement-pr` are guarded by `github.event.label.name` and
  // nothing else, so the narrow type list is their whole guard. Widen it to
  // `unlabeled` and taking `agent:review` off a PR would start a review run;
  // widen it to `assigned` and the clause would read a label that is not there.
  // Anything added here needs an action clause on both jobs first.
  assert.deepEqual(typesOf(template, "pull_request_target"), ["labeled"]);
});

test("removing a blocking label or an assignee wakes the dispatcher and nothing else", () => {
  // Every job, not only the dispatcher: widening the trigger set delivers the
  // new events to all of them, and a job whose condition reads a label without
  // naming its action would answer an event it was never meant to see.
  assert.deepEqual(
    [...conditions.keys()],
    ["dispatch", "implement", "review", "implement-pr", "merge-gate", "audit", "update-branch"],
    "every job in the caller is guarded by a condition this test evaluates",
  );
  for (const { action, label, wakes } of ISSUE_EVENTS) {
    const payload = issueEvent(action, label);
    const woken = [...conditions].filter(([, condition]) => evaluate(condition, payload)).map(([id]) => id);
    assert.deepEqual(woken, wakes, `issues: ${action}${label ? ` (${label})` : ""} wakes ${wakes.join(", ") || "nothing"}`);
  }
});

test("a label the factory removed wakes no sweep, and a label a human removed still does", () => {
  // #170 in one assertion, on the trigger decision itself. A cancelled run
  // leaves its agent:* label for a cleanup step, and that removal fires
  // `unlabeled` because the factory writes with a PAT. A dispatcher that
  // answered it would re-stamp agent:implement and the cancel would have
  // bought nothing: twelve cancels on one target became fourteen runs in
  // flight inside two minutes.
  const dispatch = conditions.get("dispatch")!;
  for (const label of ["agent:implement", "agent:in-progress", "agent:review", "agent:blocked", "factory:retry-1"]) {
    assert.equal(evaluate(dispatch, issueEvent("unlabeled", label)), false, `removing ${label} wakes no sweep`);
  }
  // The other half, which is why the trigger earns its place at all: a human
  // letting go of a ticket reaches the factory now, not on the next heartbeat.
  for (const label of ["ready-for-human", "needs-triage", "needs-human"]) {
    assert.equal(evaluate(dispatch, issueEvent("unlabeled", label)), true, `removing ${label} wakes the sweep`);
  }
  assert.equal(evaluate(dispatch, issueEvent("unassigned")), true, "dropping the assignee wakes the sweep");
});

test("the prose that names the dispatcher's issue triggers names the caller's set", () => {
  const subscribed = typesOf(template, "issues");
  for (const site of TRIGGER_SET_SITES) {
    const text = fs.readFileSync(new URL(`../../${site}`, import.meta.url), "utf8");
    const named = [...text.matchAll(/issues: \[([^\]]*)\]/g)].map((match) =>
      match[1]!.split(",").map((type) => type.trim()).sort(),
    );
    assert.equal(named.length, 1, `${site} names the issue trigger set exactly once`);
    assert.deepEqual(named[0], subscribed, `${site} names the trigger set the caller subscribes to`);
  }
});
