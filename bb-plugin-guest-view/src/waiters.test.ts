import assert from "node:assert/strict";
import { test } from "node:test";
import { WaitSet, type WaitEnd } from "./waiters.ts";

const never = new AbortController().signal;
/** Starts a wait and records how it ended. */
function start(set: WaitSet, client: string, ip: string, ms = 10_000, closed: AbortSignal = never) {
  const result: { end: WaitEnd | null } = { end: null };
  const done = set.wait(client, ip, ms, closed).then((end) => {
    result.end = end;
    return end;
  });
  return { result, done };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("a page holds at most perClient waiting polls: a newer one releases the oldest", async () => {
  const set = new WaitSet({ perClient: 3, perIp: 100, total: 100 });
  const polls = Array.from({ length: 50 }, () => start(set, "page-a", "1.1.1.1"));
  await tick();
  assert.equal(set.size, 3, "fifty polls from one page leave three waiting");
  assert.equal(polls.filter((p) => p.result.end === "released").length, 47);
  assert.deepEqual(polls.slice(-3).map((p) => p.result.end), [null, null, null], "the newest are the ones still waiting");
  set.wakeAll();
  await Promise.all(polls.map((p) => p.done));
  assert.equal(set.size, 0);
  assert.deepEqual(polls.slice(-3).map((p) => p.result.end), ["woken", "woken", "woken"]);
});

test("an address holds at most perIp waiting polls across its pages", async () => {
  const set = new WaitSet({ perClient: 3, perIp: 6, total: 100 });
  const mine = Array.from({ length: 10 }, (_, i) => start(set, `page-${i}`, "9.9.9.9"));
  const other = start(set, "someone-else", "8.8.8.8");
  await tick();
  assert.equal(set.size, 7, "six from one address, one from another");
  assert.equal(other.result.end, null, "another address is not pushed out");
  assert.equal(mine.filter((p) => p.result.end === "released").length, 4);
  set.wakeAll();
});

test("a full share refuses a new poll and leaves those waiting alone", async () => {
  const set = new WaitSet({ perClient: 3, perIp: 100, total: 4 });
  const waiting = Array.from({ length: 4 }, (_, i) => start(set, `page-${i}`, `10.0.0.${i}`));
  const late = start(set, "page-late", "10.0.0.99");
  await tick();
  assert.equal(late.result.end, "full");
  assert.ok(waiting.every((p) => p.result.end === null));
  assert.equal(set.size, 4);
  set.wakeAll();
});

test("a wait ends on its timeout, and when the request is closed", async () => {
  const set = new WaitSet({ perClient: 3, perIp: 6, total: 40 });
  const timed = start(set, "a", "1.1.1.1", 20);
  assert.equal(await timed.done, "timeout");
  const gone = new AbortController();
  const closed = start(set, "b", "1.1.1.2", 10_000, gone.signal);
  await tick();
  assert.equal(set.size, 1);
  gone.abort();
  assert.equal(await closed.done, "closed");
  assert.equal(set.size, 0);
  const already = new AbortController();
  already.abort();
  assert.equal(await set.wait("c", "1.1.1.3", 1000, already.signal), "closed");
  assert.equal(set.size, 0);
});
