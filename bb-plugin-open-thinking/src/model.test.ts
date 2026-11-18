import assert from "node:assert/strict";
import { test } from "node:test";
import {
  atEnd,
  claimLive,
  clickedNow,
  keepOpen,
  mayClick,
  newestFresh,
  MAX_TRIES,
  SETTLE_MS,
  isThinkingId,
  isTurnRowId,
  LIVE_CLAIM_MS,
  LIVE_KEY,
  own,
  plan,
  threadOf,
  turnOf,
  type Entry,
  type Owned,
  type PaneMemory,
  type Rules,
} from "./model.ts";

const T = "thr_a";
const row = (n: number, turn = "t1") => `${T}:op:reasoning:kind:reasoning|turn:${turn}|parent:root|item:i${n}`;
const entry = (key: string, over: Partial<Entry> = {}): Entry => ({ key, open: false, live: false, folded: false, turn: turnOf(key), ...over });
const live = (open = false): Entry => ({ key: LIVE_KEY, open, live: true, folded: false, turn: null });
const rules = (over: Partial<Rules> = {}): Rules => ({ autoExpand: true, closeOnNew: false, closeOnFinish: false, keepLatest: false, followGrowth: false, ...over });
const none: ReadonlySet<string> = new Set();
const run = (entries: Entry[], r: Rules, working: boolean | null = true, owned: ReadonlySet<string> = none) =>
  plan({ entries, rules: r, working, owned });

test("ids: thinking rows, their thread and turn, turn rows", () => {
  assert.equal(threadOf(row(1)), T);
  assert.equal(turnOf(row(1, "t9")), "t9");
  assert.equal(isThinkingId(row(1)), true);
  // A work group holds a thinking id after its own prefix, and a user row is not one.
  assert.equal(isThinkingId(`${T}:t1:work-summary:${row(1)}`), false);
  assert.equal(isThinkingId(`${T}:user-seed:1`), false);
  assert.equal(isThinkingId("garbage"), false);
  assert.equal(isThinkingId(""), false);
  assert.equal(turnOf(`${T}:user-seed:1`), null);
  assert.equal(isTurnRowId(`${T}:t1:turn:0`), true);
  assert.equal(isTurnRowId(`${T}:t1:turn`), true);
  assert.equal(isTurnRowId(row(1)), false);
  assert.equal(isTurnRowId(`${T}:t1:work-summary:x`), false);
});

test("autoExpand off: nothing is clicked", () => {
  assert.deepEqual(run([entry(row(1)), live()], rules({ autoExpand: false })), []);
});

test("autoExpand on: every closed entry opens, open ones are left", () => {
  const changes = run([entry(row(1)), entry(row(2), { open: true }), live()], rules());
  assert.deepEqual(changes, [{ key: row(1), open: true }, { key: LIVE_KEY, open: true }]);
});

test("a key the reader owns is never touched, either way", () => {
  assert.deepEqual(run([entry(row(1))], rules(), true, new Set([row(1)])), []);
  assert.deepEqual(run([entry(row(1), { open: true }), entry(row(2))], rules({ closeOnNew: true }), true, new Set([row(1)])), [
    { key: row(2), open: true },
  ]);
});

test("closeOnNew: only the last entry on the pane is open", () => {
  const changes = run([entry(row(1), { open: true }), entry(row(2), { open: true }), entry(row(3))], rules({ closeOnNew: true }));
  assert.deepEqual(changes, [
    { key: row(1), open: false },
    { key: row(2), open: false },
    { key: row(3), open: true },
  ]);
});

test("closeOnNew: the live line counts as the last one", () => {
  const changes = run([entry(row(1), { open: true }), live()], rules({ closeOnNew: true }));
  assert.deepEqual(changes, [{ key: row(1), open: false }, { key: LIVE_KEY, open: true }]);
});

test("closeOnNew: an owned earlier entry stays open beside the new one", () => {
  const changes = run([entry(row(1), { open: true }), entry(row(2))], rules({ closeOnNew: true }), true, new Set([row(1)]));
  assert.deepEqual(changes, [{ key: row(2), open: true }]);
});

test("closeOnFinish: a finished thread closes its entries", () => {
  const changes = run([entry(row(1), { open: true }), entry(row(2))], rules({ closeOnFinish: true }), false);
  assert.deepEqual(changes, [{ key: row(1), open: false }]);
});

test("closeOnFinish: entries in a Worked-for row are closed even while the thread runs", () => {
  const changes = run(
    [entry(row(1, "old"), { open: true, folded: true }), entry(row(2, "new"))],
    rules({ closeOnFinish: true }),
    true,
  );
  assert.deepEqual(changes, [{ key: row(1, "old"), open: false }, { key: row(2, "new"), open: true }]);
});

test("closeOnFinish: while working, a row of an older turn is finished, the newest turn's is not", () => {
  const changes = run([entry(row(1, "old"), { open: true }), entry(row(2, "new"))], rules({ closeOnFinish: true }), true);
  assert.deepEqual(changes, [{ key: row(1, "old"), open: false }, { key: row(2, "new"), open: true }]);
});

test("closeOnFinish: nothing outside a Worked-for row is touched until the status is known", () => {
  const entries = [entry(row(1, "old"), { open: true }), entry(row(2, "new")), entry(row(3, "x"), { open: true, folded: true })];
  assert.deepEqual(run(entries, rules({ closeOnFinish: true }), null), [{ key: row(3, "x"), open: false }]);
  // The live line only exists while a turn runs, so it opens whatever the status.
  assert.deepEqual(run([live()], rules({ closeOnFinish: true }), null), [{ key: LIVE_KEY, open: true }]);
});

test("closeOnFinish: a reader-owned entry in a finished turn stays as it is", () => {
  assert.deepEqual(run([entry(row(1), { open: true })], rules({ closeOnFinish: true }), false, new Set([row(1)])), []);
});

test("both close options together", () => {
  const r = rules({ closeOnNew: true, closeOnFinish: true });
  const changes = run([entry(row(1, "t1"), { open: true }), entry(row(2, "t2")), entry(row(3, "t2"))], r, true);
  assert.deepEqual(changes, [{ key: row(1, "t1"), open: false }, { key: row(3, "t2"), open: true }]);
});

test("a row without a turn id is never finished by turn", () => {
  const odd = entry(`${T}:op:reasoning:other`, { open: true });
  assert.deepEqual(run([odd, entry(row(2, "new"))], rules({ closeOnFinish: true }), true), [{ key: row(2, "new"), open: true }]);
});

test("same page, same answer: a plan after a remount does not depend on earlier plans", () => {
  const entries = [entry(row(1)), entry(row(2))];
  assert.deepEqual(run(entries, rules()), run(entries, rules()));
});

test("owned is per thread", () => {
  const store: Owned = new Map();
  own(store, T, row(1));
  own(store, T, row(2));
  own(store, "thr_b", row(1));
  assert.deepEqual([...(store.get(T) ?? [])], [row(1), row(2)]);
  assert.equal(store.get("thr_b")?.size, 1);
});

const memory = (over: Partial<PaneMemory> = {}): PaneMemory => ({ seen: new Set(), known: new Set(), latest: null, liveOwned: false, goneAt: null, ...over });

test("claimLive: without a click on the live line nothing is claimed, and the keys are remembered", () => {
  const m = memory();
  assert.equal(claimLive(m, [entry(row(1))], 0), null);
  assert.deepEqual([...m.seen], [row(1)]);
});

test("claimLive: the row that arrives after the live line left inherits the click", () => {
  const m = memory({ liveOwned: true, seen: new Set([row(1)]) });
  // The live line is up: nothing yet.
  assert.equal(claimLive(m, [entry(row(1)), live()], 100), null);
  assert.equal(m.liveOwned, true);
  // It left and no row yet.
  assert.equal(claimLive(m, [entry(row(1))], 200), null);
  assert.equal(m.liveOwned, true);
  // The row lands.
  assert.equal(claimLive(m, [entry(row(1)), entry(row(2))], 1200), row(2));
  assert.equal(m.liveOwned, false);
});

test("claimLive: a claim that finds no row lapses, so a later row is not taken for it", () => {
  const m = memory({ liveOwned: true, seen: new Set([row(1)]) });
  assert.equal(claimLive(m, [entry(row(1))], 0), null);
  assert.equal(claimLive(m, [entry(row(1))], LIVE_CLAIM_MS + 1), null);
  assert.equal(m.liveOwned, false);
  assert.equal(claimLive(m, [entry(row(1)), entry(row(2))], LIVE_CLAIM_MS + 2), null);
});

test("mayClick: once per target, again only when BB undid it after the settle time, at most MAX_TRIES in a row", () => {
  assert.equal(mayClick(undefined, true, 0), true);
  const first = clickedNow(undefined, true, 0);
  assert.equal(first.tries, 1);
  assert.equal(mayClick(first, true, SETTLE_MS - 1), false);
  assert.equal(mayClick(first, true, SETTLE_MS + 1), true);
  assert.equal(mayClick(first, false, 1), true);
  let last = first;
  for (let at = 1; at < MAX_TRIES; at++) last = clickedNow(last, true, at * 1000);
  assert.equal(last.tries, MAX_TRIES);
  assert.equal(mayClick(last, true, 99_000), false);
  assert.equal(clickedNow(last, false, 99_000).tries, 1);
});

test("newestFresh: the newest unseen thought; none for a reader's unfolding or the live line", () => {
  const entries = [entry(row(1)), entry(row(2)), { ...live(), key: LIVE_KEY }];
  assert.equal(newestFresh(entries, new Set(), false)?.key, row(2));
  assert.equal(newestFresh(entries, new Set([row(2)]), false)?.key, row(1));
  assert.equal(newestFresh(entries, new Set([row(1), row(2)]), false), null);
  assert.equal(newestFresh(entries, new Set(), true), null);
});

test("keepOpen: closed, present, not the reader's rows of the chain, only while working", () => {
  const present = new Map([["g1", false], ["g2", true], ["g3", false]]);
  const base = { chain: ["g1", "g2", "g3", "gone"], present, owned: new Set(["g3"]) };
  assert.deepEqual(keepOpen({ ...base, working: true }), ["g1"]);
  assert.deepEqual(keepOpen({ ...base, working: false }), []);
  assert.deepEqual(keepOpen({ ...base, working: null }), []);
});

test("atEnd: within the slack of the end", () => {
  assert.equal(atEnd({ scrollTop: 100, clientHeight: 300, scrollHeight: 400 }), true);
  assert.equal(atEnd({ scrollTop: 97, clientHeight: 300, scrollHeight: 400 }), true);
  assert.equal(atEnd({ scrollTop: 50, clientHeight: 300, scrollHeight: 400 }), false);
});
