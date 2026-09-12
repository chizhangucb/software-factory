/**
 * The cadence claim (#265): what the sender says when the rhythm it is run at
 * stops agreeing with the interval this repo documents.
 *
 * The interval is imported and never retyped, so these tests still mean what
 * they say if the documented number moves. Every timestamp is the test's own:
 * the clock is an argument, so nothing here sleeps or waits for a real pass.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { AGREEING_BAND, DISAGREEING_PASSES, PASS_LOG_ENV, cadenceLine, passLogPath, withPass } from "./cadence.ts";
import { HEARTBEAT_INTERVAL_MINUTES, INTERVAL_PHRASE } from "./interval.ts";

/** A pass log of gaps, newest last, ending the moment before `now`. */
const logOfGaps = (now: Date, gapMinutes: number, gaps: number): string => {
  const stamps: string[] = [];
  for (let behind = gaps; behind >= 1; behind -= 1) stamps.push(new Date(now.getTime() - behind * gapMinutes * 60_000).toISOString());
  return `${stamps.join("\n")}\n`;
};

const NOW = new Date("2026-09-12T12:00:00.000Z");

test("a first pass with nothing to compare against claims nothing", () => {
  // Acceptance criterion 4. A host that has just been onboarded has no history
  // and is not evidence of anything.
  assert.equal(cadenceLine("", NOW), undefined);
});

test("a run of passes at the wrong cadence names both numbers and what to change", () => {
  // Acceptance criterion 1. A host running the sender at twice the documented
  // interval is the drift this exists to find, and the line has to carry
  // enough to act on: the rhythm observed, the rhythm documented, and the two
  // places either could be corrected.
  const observed = HEARTBEAT_INTERVAL_MINUTES * 2;
  const line = cadenceLine(logOfGaps(NOW, observed, DISAGREEING_PASSES), NOW);
  assert.ok(line, "a run of disagreeing gaps is said out loud");
  assert.ok(line.includes(String(observed)), `the line names the observed cadence: ${line}`);
  assert.ok(line.includes(INTERVAL_PHRASE), `the line names the documented interval: ${line}`);
  assert.ok(line.includes("HEARTBEAT_INTERVAL_MINUTES"), `the line names the constant to change: ${line}`);
  assert.ok(/schedul/i.test(line), `the line names the host's schedule as the other thing to change: ${line}`);
});

test("a pass at the documented cadence claims nothing, so the line is not noise", () => {
  // Acceptance criterion 2. A host running the sender at the interval this
  // repo documents is the ordinary case, and every ordinary pass printing a
  // line is how a maintainer learns to skip the one that matters.
  assert.equal(cadenceLine(logOfGaps(NOW, HEARTBEAT_INTERVAL_MINUTES, DISAGREEING_PASSES), NOW), undefined);
});

test("a single late pass claims nothing, because a laptop that sleeps is the common case", () => {
  // Acceptance criterion 3, which is the whole reason the claim is about a run.
  // A machine asleep overnight leaves one enormous gap and then goes back to
  // the host's own rhythm; a nag every morning is the output nobody would read.
  const overnight = logOfGaps(NOW, HEARTBEAT_INTERVAL_MINUTES, DISAGREEING_PASSES).split("\n");
  overnight[0] = new Date(NOW.getTime() - 9 * 60 * 60_000).toISOString();
  assert.equal(cadenceLine(overnight.join("\n"), NOW), undefined);
});

test("a run one pass short of the threshold claims nothing, so the threshold is the one pinned here", () => {
  // The other edge of the same criterion: the number in the module is the
  // number enforced, and a host whose schedule really moved says so on the next
  // pass rather than never.
  const wrong = HEARTBEAT_INTERVAL_MINUTES * 2;
  assert.equal(cadenceLine(logOfGaps(NOW, wrong, DISAGREEING_PASSES - 1), NOW), undefined);
  assert.ok(cadenceLine(logOfGaps(NOW, wrong, DISAGREEING_PASSES), NOW), "one more disagreeing gap is the claim");
});

test("a run of passes faster than the documented interval is drift too", () => {
  // The number can move either way: a host set to a shorter interval pays a
  // billed minute per pass for oversampling nobody chose.
  const line = cadenceLine(logOfGaps(NOW, HEARTBEAT_INTERVAL_MINUTES / 3, DISAGREEING_PASSES), NOW);
  assert.ok(line?.includes(String(HEARTBEAT_INTERVAL_MINUTES / 3)), `the line names the observed cadence: ${line}`);
});

test("the log keeps the run being judged and no more, so the sender's state stays a few lines", () => {
  const many = logOfGaps(NOW, HEARTBEAT_INTERVAL_MINUTES, DISAGREEING_PASSES * 5);
  const lines = withPass(many, NOW).trimEnd().split("\n");
  assert.equal(lines.length, DISAGREEING_PASSES, "the run the next pass judges, and nothing older");
  assert.equal(lines.at(-1), NOW.toISOString(), "this pass is the newest");
  // And a log kept this way is exactly long enough to make the claim on the
  // next pass, which is the only reason the length is what it is.
  const wrong = HEARTBEAT_INTERVAL_MINUTES * 2;
  const kept = logOfGaps(NOW, wrong, DISAGREEING_PASSES * 5);
  const next = new Date(NOW.getTime() + wrong * 60_000);
  assert.ok(cadenceLine(withPass(kept, NOW), next), "the kept log still holds a run");
});

test("an unreadable line in the log costs a gap and not the claim", () => {
  // A pass a host killed mid-write leaves a partial line. Dropping it is one
  // gap fewer to judge on, which is the cheap answer; throwing would be a line
  // that says the cadence cannot be read, which nobody asked about.
  //
  // Pinned against the claim the same log makes whole, so this says "one gap
  // fewer" rather than only "nothing thrown": a run of disagreeing gaps whose
  // oldest stamp is unreadable is a run one short, and that is no claim.
  const wrong = HEARTBEAT_INTERVAL_MINUTES * 2;
  const whole = logOfGaps(NOW, wrong, DISAGREEING_PASSES).trimEnd().split("\n");
  assert.ok(cadenceLine(whole.join("\n"), NOW), "the whole log claims");
  assert.equal(cadenceLine(["half a timest", ...whole.slice(1)].join("\n"), NOW), undefined);
});

test("a gap exactly on the edge of the band disagrees, because half the interval is twice the bill", () => {
  // The band is the other half of what counts as disagreement, and it is
  // pinned here rather than left to the numbers the tests above happen to use:
  // widened, a halved host interval would stop being said out loud.
  const onTheEdge = HEARTBEAT_INTERVAL_MINUTES * (1 - AGREEING_BAND);
  assert.ok(cadenceLine(logOfGaps(NOW, onTheEdge, DISAGREEING_PASSES), NOW), "the edge is not agreement");
  // And just inside it is, so the band is a band and not a point.
  const justInside = onTheEdge + HEARTBEAT_INTERVAL_MINUTES / 10;
  assert.equal(cadenceLine(logOfGaps(NOW, justInside, DISAGREEING_PASSES), NOW), undefined);
});

test("a log out of order claims nothing, so a clock that moved backwards invents no cadence", () => {
  // The log is append-only, so its order is the order the passes ran in and it
  // is read that way. Sorting it would turn a clock change into a run of
  // plausible gaps and report a cadence nothing was ever run at.
  const wrong = HEARTBEAT_INTERVAL_MINUTES * 2;
  const stamps = logOfGaps(NOW, wrong, DISAGREEING_PASSES).trimEnd().split("\n");
  const shuffled = [stamps[1]!, stamps[0]!, ...stamps.slice(2)];
  assert.equal(cadenceLine(shuffled.join("\n"), NOW), undefined);
});

test("the pass log is one file, overridable, so nothing here writes a real host's state", () => {
  assert.equal(passLogPath({ [PASS_LOG_ENV]: "/tmp/passes" }, "/home/me"), "/tmp/passes");
  assert.equal(passLogPath({}, "/home/me"), "/home/me/.factory-heartbeat-passes");
});
