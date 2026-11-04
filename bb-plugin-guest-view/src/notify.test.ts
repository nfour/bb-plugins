import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { describePrompts, NoticeBatch, type Notice } from "./notify.ts";

test("one prompt is told by name, long text cut", () => {
  assert.deepEqual(describePrompts([{ name: "Lydia", text: "rename the button" }]), { title: "Lydia suggested a prompt", body: "rename the button" });
  const long = describePrompts([{ name: "Lydia", text: "x".repeat(300) }]);
  assert.equal(long.body.length, 140);
  assert.ok(long.body.endsWith("…"));
});

test("several prompts are told as a count and the names", () => {
  const prompts = ["Ann", "Ben", "Ann", "Cy", "Di", "Ed"].map((name) => ({ name, text: "t" }));
  assert.deepEqual(describePrompts(prompts), { title: "6 new guest prompts", body: "From Ann, Ben, Cy and 2 more" });
  assert.equal(describePrompts([{ name: "Ann", text: "a" }, { name: "Ann", text: "b" }]).body, "From Ann");
});

test("the first prompt goes at once and a flood is folded into one summary per window", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const sent: Notice[] = [];
  const batch = new NoticeBatch((notice) => sent.push(notice), 30_000);
  batch.add({ name: "Ann", text: "first" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.title, "Ann suggested a prompt");
  for (let i = 0; i < 20; i += 1) batch.add({ name: i % 2 ? "Ben" : "Cy", text: `p${i}` });
  assert.equal(sent.length, 1, "nothing more goes within the window");
  t.mock.timers.tick(29_000);
  assert.equal(sent.length, 1);
  t.mock.timers.tick(1_000);
  assert.equal(sent.length, 2, "the rest arrive as one summary");
  assert.equal(sent[1]!.title, "20 new guest prompts");
  t.mock.timers.tick(120_000);
  assert.equal(sent.length, 2, "an empty window sends nothing");
  batch.add({ name: "Di", text: "later" });
  assert.equal(sent.length, 3, "after a quiet window the next prompt goes at once again");
});

test("cancel drops what is waiting", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 5_000_000 });
  const sent: Notice[] = [];
  const batch = new NoticeBatch((notice) => sent.push(notice), 30_000);
  batch.add({ name: "Ann", text: "1" });
  batch.add({ name: "Ann", text: "2" });
  batch.cancel();
  t.mock.timers.tick(60_000);
  assert.equal(sent.length, 1);
  mock.reset();
});
