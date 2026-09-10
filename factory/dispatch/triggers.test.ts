/**
 * Which events reach the dispatcher, and what the caller's condition does with
 * each of them. The subject is `templates/factory.yml`, so the file is the
 * fixture: a target's caller is the only place the trigger list and the
 * dispatch job's `if:` exist, and neither is reachable from a unit test of the
 * selection module.
 *
 * The condition is evaluated rather than pattern-matched, because the bug this
 * guards against is a silent one. An `unassigned` payload carries no `label`,
 * so a clause that reads `github.event.label.name` without first saying which
 * action it is for reads null, compares false, and drops the event with no
 * error anywhere. `evaluate` below therefore throws on a dereference GitHub
 * would answer with null, which turns that silence into a failing test.
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

/** A job's `if:` expression, folded block or one-liner, with the leading `>-` gone. */
const conditionOf = (yaml: string, jobId: string): string => {
  const job = yaml.match(new RegExp(String.raw`\n  ${jobId}:\n((?: {4}\S.*\n| {6,}.*\n|\n)*)`));
  assert.ok(job, `the caller template has a ${jobId} job`);
  const block = job[1]!.match(/^ {4}if:(.*)\n((?: {6}.*\n)*)/m);
  assert.ok(block, `the ${jobId} job has an if: condition`);
  return `${block[1]!.replace(/>-|>|\|-|\|/, "")} ${block[2]!}`.replace(/\s+/g, " ").trim();
};

/** A webhook payload as the condition sees it: whatever GitHub sends, and nothing else. */
type Context = { event_name: string; event?: Record<string, unknown> };

/**
 * Answer the condition as GitHub would, except that reading through an absent
 * field throws instead of returning null. That is the whole point: the caller
 * must say which action each clause is for.
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
  const skeleton = js.replace(/"[^"]*"/g, '""');
  assert.doesNotMatch(skeleton, /[^\s\w".,()!=&|]/, `the condition uses syntax this test cannot evaluate: ${expression}`);
  return Boolean(new Function("read", `return (${js});`)(read));
};

const issueEvent = (action: string, label?: string): Context => ({
  event_name: "issues",
  event: label === undefined ? { action } : { action, label: { name: label } },
});

/**
 * Every issue event the caller subscribes to, and whether the dispatcher should
 * see it. `unlabeled` and `unassigned` are admitted whatever was removed: which
 * removals can unblock a ticket is the selection module's answer, and a caller
 * that tried to name them would be a second copy of it, drifting silently. A
 * superfluous scan labels nothing.
 */
const ISSUE_EVENTS: { action: string; label?: string; dispatches: boolean }[] = [
  { action: "labeled", label: "ready-for-agent", dispatches: true },
  { action: "labeled", label: "agent:implement", dispatches: false },
  { action: "labeled", label: "documentation", dispatches: false },
  { action: "unlabeled", label: "ready-for-human", dispatches: true },
  { action: "unlabeled", label: "needs-triage", dispatches: true },
  { action: "unlabeled", label: "ready-for-agent", dispatches: true },
  { action: "unassigned", dispatches: true },
  { action: "closed", dispatches: true },
];

/** The event types a `on:` block subscribes to, as a sorted list. */
const typesOf = (yaml: string, event: string): string[] => {
  const types = yaml.match(new RegExp(String.raw`\n  ${event}:\n(?: {4}#.*\n)*    types: \[([^\]]*)\]`));
  assert.ok(types, `the caller template subscribes to ${event}`);
  return types[1]!.split(",").map((type) => type.trim()).sort();
};

test("the caller subscribes to exactly the issue events the dispatch condition answers", () => {
  const subscribed = typesOf(template, "issues");
  assert.deepEqual(subscribed, ["closed", "labeled", "unassigned", "unlabeled"]);
  // Neither half is any use alone: a type nobody answers is a run that does
  // nothing, and a clause for a type nobody subscribes to never fires.
  assert.deepEqual([...new Set(ISSUE_EVENTS.map((event) => event.action))].sort(), subscribed);
});

/**
 * The two places that name the trigger set in prose. Neither is reachable from
 * the caller, so a trigger added to the template leaves both stale and a reader
 * is told the dispatcher runs on less than it does.
 */
const PROSE_SITES = ["docs/pipeline.md", ".github/workflows/dispatch.yml"];

test("the prose that names the dispatcher's issue triggers names the caller's set", () => {
  const subscribed = typesOf(template, "issues");
  for (const site of PROSE_SITES) {
    const text = fs.readFileSync(new URL(`../../${site}`, import.meta.url), "utf8");
    const named = [...text.matchAll(/issues: \[([^\]]*)\]/g)].map((match) =>
      match[1]!.split(",").map((type) => type.trim()).sort(),
    );
    assert.equal(named.length, 1, `${site} names the issue trigger set exactly once`);
    assert.deepEqual(named[0], subscribed, `${site} names the trigger set the caller subscribes to`);
  }
});

test("removing a blocking label or an assignee dispatches, and no clause reads a label off an event without one", () => {
  const condition = conditionOf(template, "dispatch");
  for (const { action, label, dispatches } of ISSUE_EVENTS) {
    assert.equal(
      evaluate(condition, issueEvent(action, label)),
      dispatches,
      `issues: ${action}${label ? ` (${label})` : ""} should ${dispatches ? "" : "not "}reach the dispatcher`,
    );
  }
});
