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
 * `github.*` paths, single-quoted strings, `==`, `!=`, `&&`, `||` and parens.
 * A condition that outgrows it fails loudly here rather than being waved
 * through.
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
  assert.doesNotMatch(
    js.replace(/"[^"]*"/g, '""'),
    /[^\s\w".,()!=&|]/,
    `the condition uses syntax this test cannot evaluate: ${expression}`,
  );
  return Boolean(new Function("read", `return (${js});`)(read));
};

const issueEvent = (action: string, label?: string): Context => ({
  event_name: "issues",
  event: label === undefined ? { action } : { action, label: { name: label } },
});

/**
 * Every issue event the caller subscribes to, and the jobs it should wake.
 * `unlabeled` and `unassigned` wake the dispatcher whatever was removed: which
 * removals can actually unblock a ticket is select.ts's answer, and a caller
 * that named them would be a second copy of those rules. A scan over a ticket
 * nothing unblocked labels nothing.
 */
const ISSUE_EVENTS: { action: string; label?: string; wakes: string[] }[] = [
  { action: "labeled", label: "ready-for-agent", wakes: ["dispatch"] },
  { action: "labeled", label: "agent:implement", wakes: ["implement"] },
  { action: "labeled", label: "documentation", wakes: [] },
  { action: "unlabeled", label: "ready-for-human", wakes: ["dispatch"] },
  { action: "unlabeled", label: "needs-triage", wakes: ["dispatch"] },
  { action: "unlabeled", label: "ready-for-agent", wakes: ["dispatch"] },
  // Removing agent:implement is how the reconciler re-fires a stranded ticket.
  // It must reach the dispatcher and nothing else: an implement job that read
  // the label without its action would start a run on the label coming off.
  { action: "unlabeled", label: "agent:implement", wakes: ["dispatch"] },
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
    ["dispatch", "implement", "review", "implement-pr", "gate", "audit", "update-branch"],
    "every job in the caller is guarded by a condition this test evaluates",
  );
  for (const { action, label, wakes } of ISSUE_EVENTS) {
    const payload = issueEvent(action, label);
    const woken = [...conditions].filter(([, condition]) => evaluate(condition, payload)).map(([id]) => id);
    assert.deepEqual(woken, wakes, `issues: ${action}${label ? ` (${label})` : ""} wakes ${wakes.join(", ") || "nothing"}`);
  }
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
