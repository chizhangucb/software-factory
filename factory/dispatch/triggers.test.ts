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
 * and the names in `CALLABLE`. A condition that outgrows it fails loudly here
 * rather than being waved through.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

import { AGENT_LABEL_PREFIX, FACTORY_LABEL_PREFIX } from "../lib/labels.ts";
import { RETRY_LABEL_PREFIX } from "../retry/decide.ts";

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

/**
 * A webhook payload as a condition sees it: whatever GitHub sends, plus the
 * target's repository variables, which a job-level `if:` can read where a
 * `secrets` reference cannot.
 */
type Context = { event_name: string; event?: Record<string, unknown>; vars?: Record<string, string> };

/**
 * The one repository variable the caller reads. Empty or unset means running;
 * any other value pauses the factory and *is* the reason, which is where a
 * paused target says why (#171).
 */
const PAUSE_VARIABLE = "FACTORY_PAUSED";

/**
 * GitHub's `startsWith`, including the two ways it differs from JavaScript's:
 * null coerces to the empty string rather than "null", and the comparison is
 * not case sensitive. A label named `Agent:foo` is dropped by the real caller,
 * so a double that answered it case sensitively would let the table below say
 * a removal wakes the sweep where the caller silently drops it.
 */
const startsWith = (value: unknown, prefix: unknown): boolean =>
  String(value ?? "").toLowerCase().startsWith(String(prefix ?? "").toLowerCase());

/**
 * What a caller condition may call, beyond reading a `github.*` path. An
 * identifier outside this set fails the test below rather than reaching
 * `new Function` as a ReferenceError, so the evaluator still refuses loudly
 * what it cannot answer. Add a name here and pass it below, together.
 */
const CALLABLE = ["read", "readVar", "startsWith"] as const;

/**
 * Answer a condition as GitHub would, except that reading through an absent
 * field throws instead of returning null. That is the whole point: a condition
 * must say which action each of its clauses is for.
 */
const evaluate = (expression: string, context: Context): boolean => {
  /**
   * GitHub answers an unset repository variable with the empty string, so
   * reading one is never the null dereference `read` guards against. The
   * failure that matters for a variable is the other one: a name the caller
   * spells differently from the name a maintainer sets reads empty forever,
   * which is a pause that never engages and never says so. A name this test
   * does not know therefore throws, rather than quietly answering "running".
   */
  const readVar = (name: string): string => {
    if (name !== PAUSE_VARIABLE) {
      throw new Error(`the condition read vars.${name}, and the caller's only variable is ${PAUSE_VARIABLE}`);
    }
    return context.vars?.[name] ?? "";
  };
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
    .replace(/\bvars\.([A-Za-z_]\w*)/g, (_, name: string) => `readVar(${JSON.stringify(name)})`)
    .replace(/'([^']*)'/g, (_, literal: string) => JSON.stringify(literal));
  const withoutLiterals = js.replace(/"[^"]*"/g, '""');
  assert.doesNotMatch(
    withoutLiterals,
    /[^\s\w".,()!=&|]/,
    `the condition uses syntax this test cannot evaluate: ${expression}`,
  );
  for (const name of withoutLiterals.match(/[A-Za-z_]\w*/g) ?? []) {
    assert.ok(
      (CALLABLE as readonly string[]).includes(name),
      `the condition calls ${name}, which this test cannot evaluate: ${expression}`,
    );
  }
  return Boolean(new Function("read", "readVar", "startsWith", `return (${js});`)(read, readVar, startsWith));
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
  { action: "unlabeled", label: "agent:review", wakes: [] },
  { action: "unlabeled", label: "agent:blocked", wakes: [] },
  { action: "unlabeled", label: "factory:retry-1", wakes: [] },
  { action: "unassigned", wakes: ["dispatch"] },
  { action: "closed", wakes: ["dispatch"] },
];

/**
 * One event that wakes each job, so a job's condition can be asked the only
 * question the pause makes interesting: given an event this job exists for,
 * does it still run?
 */
const WAKING_EVENTS: { job: string; context: Context }[] = [
  { job: "dispatch", context: { event_name: "repository_dispatch", event: { action: "factory-sweep" } } },
  { job: "implement", context: issueEvent("labeled", "agent:implement") },
  { job: "review", context: { event_name: "pull_request_target", event: { action: "labeled", label: { name: "agent:review" } } } },
  { job: "implement-pr", context: { event_name: "pull_request_target", event: { action: "labeled", label: { name: "agent:implement" } } } },
  { job: "merge-gate", context: { event_name: "pull_request", event: { action: "opened" } } },
  { job: "audit", context: { event_name: "pull_request", event: { action: "closed", pull_request: { merged: true } } } },
  { job: "update-branch", context: { event_name: "push" } },
];

/**
 * The two jobs a pause must never touch (#171). They are the judging half of
 * the factory: both are asked for by a pull request that already exists, and
 * neither starts or advances any work. Disabling the caller workflow, the only
 * circuit breaker before this ticket, took them down with everything else, so
 * every PR opened on a halted target silently lost `factory/red-green` and
 * `factory/test-integrity` -- checks that did not fail, they just never
 * appeared. Everything else in the caller starts work or moves it along, and
 * the pause stops all of it.
 */
const RUNS_WHILE_PAUSED = ["merge-gate", "audit"];

/** A pause as a maintainer sets it: a reason, not a boolean. */
const pausedWith = (reason: string, context: Context): Context => ({ ...context, vars: { [PAUSE_VARIABLE]: reason } });

test("a pause stops every job that starts or advances work, and neither of the two that judge a PR", () => {
  // Acceptance criterion 1, driven through the caller's real conditions: the
  // same event that wakes a job unpaused is replayed with the variable set.
  const reason = "runaway sweep on 2026-09-10, see #171";
  for (const { job, context } of WAKING_EVENTS) {
    const condition = conditions.get(job)!;
    assert.equal(evaluate(condition, context), true, `${job} wakes on the event it exists for`);
    assert.equal(
      evaluate(condition, pausedWith(reason, context)),
      RUNS_WHILE_PAUSED.includes(job),
      RUNS_WHILE_PAUSED.includes(job)
        ? `${job} keeps running while the factory is paused`
        : `${job} does not run while the factory is paused`,
    );
  }
  assert.deepEqual(
    WAKING_EVENTS.map(({ job }) => job).filter((job) => !RUNS_WHILE_PAUSED.includes(job)),
    ["dispatch", "implement", "review", "implement-pr", "update-branch"],
    "every job the pause stops is covered by an event above, not just asserted over",
  );
});

test("the pause announces itself on whatever woke the caller, and says nothing while running", () => {
  // Acceptance criterion 3. A skipped job is still an absence, and reading a
  // paused factory off one is exactly the inference this ticket refuses. The
  // `paused` job is the presence: it runs on every event the caller answers,
  // for as long as the variable is set, and its whole output is the reason.
  const condition = conditions.get("paused")!;
  for (const { job, context } of WAKING_EVENTS) {
    assert.equal(evaluate(condition, context), false, `nothing announces a pause while running (${job}'s event)`);
    assert.equal(evaluate(condition, pausedWith("incident", context)), true, `a pause is announced on ${job}'s event`);
  }
});

test("the pause is one repository variable, read the same way by every job it gates", () => {
  // The gate is a string comparison and not a boolean, because a repository
  // variable is a string and because the value has a second job: it is the
  // reason. So `paused` is every non-empty value, and a maintainer who types
  // `false` into it pauses the factory rather than arming a trap.
  for (const [job, condition] of conditions) {
    const gates = [...condition.matchAll(/vars\.(\w+) (==|!=) ''/g)].map(([, name, operator]) => `${name} ${operator}`);
    if (job === "paused") {
      assert.deepEqual(gates, [`${PAUSE_VARIABLE} !=`], "the paused job runs only while the variable is set");
    } else if (RUNS_WHILE_PAUSED.includes(job)) {
      assert.deepEqual(gates, [], `${job} must keep running while paused, so it reads no pause variable`);
    } else {
      assert.deepEqual(gates, [`${PAUSE_VARIABLE} ==`], `${job} runs only while the pause variable is empty`);
    }
  }
});

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
    ["paused", "dispatch", "implement", "review", "implement-pr", "merge-gate", "audit", "update-branch"],
    "every job in the caller is guarded by a condition this test evaluates",
  );
  for (const { action, label, wakes } of ISSUE_EVENTS) {
    const payload = issueEvent(action, label);
    const woken = [...conditions].filter(([, condition]) => evaluate(condition, payload)).map(([id]) => id);
    assert.deepEqual(woken, wakes, `issues: ${action}${label ? ` (${label})` : ""} wakes ${wakes.join(", ") || "nothing"}`);
  }
});

test("a removal in the factory's own namespaces wakes no sweep, any other removal still does", () => {
  // #170, stated over the table rather than over the caller: the test above
  // ties each row to what the caller's real condition answers, and this one
  // ties the same rows to the rule the caller is supposed to be following.
  // Together they say the condition implements the rule. A cancelled run
  // leaves its agent:* label for a cleanup step, and that removal fires
  // `unlabeled` because the factory writes with a PAT; a dispatcher that
  // answered it re-stamped agent:implement and the cancel bought nothing.
  const removals = ISSUE_EVENTS.filter((event) => event.action === "unlabeled");
  const factoryOwned = (label: string) =>
    label.startsWith(AGENT_LABEL_PREFIX) || label.startsWith(FACTORY_LABEL_PREFIX);
  const covered = { factory: 0, human: 0 };
  for (const { label, wakes } of removals) {
    if (factoryOwned(label!)) {
      covered.factory += 1;
      assert.deepEqual(wakes, [], `removing ${label} is the factory's own write and wakes nothing`);
    } else {
      covered.human += 1;
      // Why the trigger earns its place at all: a human letting go of a
      // ticket reaches the factory now, not on the next heartbeat.
      assert.deepEqual(wakes, ["dispatch"], `removing ${label} wakes the sweep`);
    }
  }
  assert.ok(covered.factory > 0 && covered.human > 0, "the table covers both kinds of removal");
});

test("the caller's namespace clauses name the prefixes the factory actually writes", () => {
  // The caller is YAML in someone else's repo, so it cannot import the
  // vocabulary and has to spell the prefixes out. This is the tie back:
  // renaming a namespace in lib/labels.ts without renaming it in the
  // template fails here instead of quietly restarting the loop. Same shape
  // as TRIGGER_SET_SITES below, which pins the prose to the caller.
  const named = [...conditions.get("dispatch")!.matchAll(/startsWith\(github\.event\.label\.name, '([^']*)'\)/g)]
    .map(([, prefix]) => prefix)
    .sort();
  assert.deepEqual(named, [AGENT_LABEL_PREFIX, FACTORY_LABEL_PREFIX].sort());
});

test("every label prefix the factory writes falls inside a namespace the caller drops", () => {
  // The clauses above are only worth anything if the factory's own labels all
  // sit in one of the two namespaces. `factory:retry-<n>` is written by the
  // retry handler, which spells its prefix out for itself. Moved outside the
  // namespace it would wake a sweep on one of the factory's own writes again,
  // which is #170 coming back quietly. Asserted here rather than fixed in
  // decide.ts, whose prefix is that module's to own.
  assert.ok(
    RETRY_LABEL_PREFIX.startsWith(FACTORY_LABEL_PREFIX),
    `${RETRY_LABEL_PREFIX} is written by the factory but falls outside ${FACTORY_LABEL_PREFIX}`,
  );
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
