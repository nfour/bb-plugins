import assert from "node:assert/strict";
import { test } from "node:test";
import { Feed, hideHistory, type Header } from "./feed.ts";
import type { GuestItem } from "./model.ts";

const header = (status = "Idle"): Header => ({ title: "T", status, model: "Opus 5.5", effort: "High", older: false });
const note = (id: string, text: string): GuestItem => ({ id, type: "note", text });

test("a first poll gets everything", () => {
  const feed = new Feed();
  assert.equal(feed.ready, false);
  feed.update(header(), [note("a", "1"), note("b", "2")]);
  const all = feed.since(0);
  assert.equal(all.reset, true);
  assert.deepEqual(all.order, ["a", "b"]);
  assert.equal(all.items.length, 2);
  assert.equal(all.prompts, undefined);
  assert.equal(all.header?.status, "Idle");
});

test("a later poll gets only what changed", () => {
  const feed = new Feed();
  feed.update(header(), [note("a", "1"), note("b", "2")]);
  const rev = feed.rev;
  assert.equal(feed.update(header(), [note("a", "1"), note("b", "2")]), false);
  assert.deepEqual(feed.since(rev), { rev, items: [] });
  feed.update(header("Working"), [note("a", "1"), note("b", "2 more")]);
  const next = feed.since(rev);
  assert.equal(next.reset, undefined);
  assert.equal(next.header?.status, "Working");
  assert.equal(next.order, undefined);
  assert.deepEqual(next.items, [note("b", "2 more")]);
});

test("new and removed items send the order", () => {
  const feed = new Feed();
  feed.update(header(), [note("a", "1"), note("b", "2")]);
  const rev = feed.rev;
  feed.update(header(), [note("b", "2"), note("c", "3")]);
  const next = feed.since(rev);
  assert.deepEqual(next.order, ["b", "c"]);
  assert.deepEqual(next.items, [note("c", "3")]);
});

test("shared prompts and the guest count bump the revision", () => {
  const feed = new Feed();
  feed.update(header(), []);
  const rev = feed.rev;
  assert.equal(feed.setPrompts([{ id: "p", name: "Alex", text: "hi" }]), true);
  assert.equal(feed.setPrompts([{ id: "p", name: "Alex", text: "hi" }]), false);
  assert.deepEqual(feed.since(rev), { rev: rev + 1, items: [], prompts: [{ id: "p", name: "Alex", text: "hi" }] });
  assert.equal(feed.setGuests(2), true);
  assert.equal(feed.setGuests(2), false);
  assert.deepEqual(feed.since(rev + 1), { rev: rev + 2, items: [], guests: 2 });
  // A first poll learns the count but gets no prompts while there are none shared.
  const first = feed.since(0);
  assert.equal(first.guests, 2);
  feed.setPrompts([]);
  assert.deepEqual(feed.since(rev + 2).prompts, []);
});

test("a count kept from guests is sent as null, not as a number", () => {
  const feed = new Feed();
  feed.update(header(), []);
  assert.equal(feed.since(0).guests, undefined);
  assert.equal(feed.setGuests(null), true);
  assert.equal(feed.setGuests(null), false);
  assert.equal(feed.since(0).guests, null);
  assert.equal(feed.setGuests(3), true);
  assert.equal(feed.since(0).guests, 3);
});

test("an unknown revision (a restarted share) resets", () => {
  const feed = new Feed();
  feed.update(header(), [note("a", "1")]);
  assert.equal(feed.since(99).reset, true);
  assert.equal(feed.since(-1).reset, true);
});

test("hideHistory leaves out what existed when the guest joined", () => {
  const feed = new Feed();
  feed.update(header(), [note("a", "1"), note("b", "2")]);
  const skip = new Set(feed.ids());
  assert.deepEqual([...skip], ["a", "b"]);
  feed.update(header(), [note("a", "1"), note("b", "2"), note("c", "3")]);
  const first = hideHistory(feed.since(0), skip);
  assert.deepEqual(first.order, ["c"]);
  assert.deepEqual(first.items.map((i) => i.id), ["c"]);
  assert.equal(first.header?.older, true);
  // A later poll that only carries an old item changed has nothing for this guest.
  const rev = feed.rev;
  feed.update(header(), [note("a", "1 more"), note("b", "2"), note("c", "3")]);
  const next = hideHistory(feed.since(rev), skip);
  assert.deepEqual(next.items, []);
  // Nothing skip: unchanged apart from a copy.
  assert.deepEqual(hideHistory(feed.since(0), new Set()).order, ["a", "b", "c"]);
});

test("hideHistory leaves out prompts that existed when the guest joined", () => {
  const feed = new Feed();
  feed.update(header(), []);
  feed.setPrompts([{ id: "old", name: "Alex", text: "one" }, { id: "new", name: "Sam", text: "two" }]);
  const out = hideHistory(feed.since(0), new Set(), new Set(["old"]));
  assert.deepEqual(out.prompts, [{ id: "new", name: "Sam", text: "two" }]);
});
