import assert from "node:assert/strict";
import { test } from "node:test";
import { rankOfRow } from "./dom.ts";
import { flatten, indexOf, mergeNewest, outlineOf, prependOlder } from "./rows.ts";
import { PIN_ROW_HEIGHT, bandAt, bandContent, dataIdOf, jumpOffset, lastAtOrAbove, oneLine, turnStatus, type Message, type Pin } from "./model.ts";

test("bandContent: last message and last reply past the line, same line for both", () => {
  const pin = (top: number, title: string): Pin<string> => ({ top, title, ref: title });
  const openers = [pin(-300, "u1"), pin(-20, "u2"), pin(90, "u3")];
  const replies = [pin(-250, "a1"), pin(10, "a2"), pin(120, "a3")];
  const got = bandContent(openers, replies, 0);
  assert.equal(got.message?.title, "u2");
  assert.equal(got.reply?.title, "a1");
  assert.equal(bandContent(openers, replies, 10).reply?.title, "a2", "a row exactly on the line is in hand");
  assert.deepEqual(bandContent(openers, replies, -400), { message: null, reply: null });
});

test("jumpOffset lands the row one bar below the line", () => {
  assert.equal(jumpOffset(500, 48), 500 - 48 - PIN_ROW_HEIGHT);
  assert.equal(jumpOffset(500, 48, 0), 452);
  assert.equal(jumpOffset(500, 48, -5), 452, "a negative room is no room");
});

test("lastAtOrAbove is a binary search over non-decreasing tops", () => {
  const tops = [-90, -40, -40, 0, 30, 31];
  for (const line of [-100, -90, -40, -1, 0, 30, 31, 500]) {
    const want = tops.reduce((last, top, i) => (top <= line ? i : last), -1);
    assert.equal(lastAtOrAbove(tops.length, (i) => tops[i]!, line), want, `line ${line}`);
  }
});

test("bandAt agrees with bandContent on random timelines", () => {
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let round = 0; round < 300; round++) {
    // Rows of every kind in order; only some are messages. Tops never decrease.
    let top = -rand() * 2000;
    const messages: Message[] = [];
    const rows: { rank: number; top: number }[] = [];
    for (let rank = 0; rank < 40; rank++) {
      top += rand() * 120;
      rows.push({ rank, top });
      const r = rand();
      if (r < 0.2) messages.push({ id: `u${rank}`, role: "user", rank, title: `u${rank}`, full: "", by: "user" });
      else if (r < 0.45) messages.push({ id: `a${rank}`, role: "assistant", rank, title: `a${rank}`, full: "", by: "user" });
    }
    const line = rand() * 1500 - 1000;
    const pins = (role: Message["role"]) =>
      messages
        .filter((m) => m.role === role)
        .map((m) => ({ top: rows[m.rank]!.top, title: m.title, ref: m.id }));
    const oracle = bandContent(pins("user"), pins("assistant"), line);
    const at = lastAtOrAbove(rows.length, (i) => rows[i]!.top, line);
    const got = at < 0 ? { message: null, reply: null } : bandAt(messages, at);
    assert.equal(got.message?.id ?? null, oracle.message?.ref ?? null, `round ${round} message`);
    assert.equal(got.reply?.id ?? null, oracle.reply?.ref ?? null, `round ${round} reply`);
  }
});

test("oneLine collapses whitespace and drops fences and heading marks", () => {
  assert.equal(oneLine("## Plan\n\n```ts\nconst a = 1;\n```\n  next"), "Plan const a = 1; next");
  assert.equal(oneLine("x".repeat(500)).length, 240);
});

test("dataIdOf unwraps a folded work-summary row id", () => {
  assert.equal(dataIdOf("thr_a:user-seed:3"), "thr_a:user-seed:3");
  assert.equal(dataIdOf("thr_a:da-t5:work-summary:thr_a:command:da-i217"), "thr_a:command:da-i217");
});

test("turnStatus: in progress wins, then the last of reply/failure/interruption", () => {
  assert.equal(turnStatus([]), undefined);
  assert.equal(turnStatus(["assistant"]), undefined);
  assert.equal(turnStatus(["assistant", "pending"]), "pending");
  assert.equal(turnStatus(["error"]), "error");
  assert.equal(turnStatus(["error", "assistant"]), undefined, "a reply after the error recovered the turn");
  assert.equal(turnStatus(["assistant", "interrupted"]), "interrupted");
  assert.equal(turnStatus(["interrupted", "error"]), "error");
});

// Rows as the timeline gives them, cut down to the fields `indexOf` reads.
const user = (seq: number, text = `q${seq}`, extra: object = {}) =>
  ({ kind: "conversation", role: "user", id: `t:user-seed:${seq}`, messageSeq: seq, text, mentions: [], initiator: "user", ...extra }) as never;
const reply = (n: number, text = `a${n}`) => ({ kind: "conversation", role: "assistant", id: `t:assistant:${n}`, messageSeq: 0, text }) as never;
const work = (status: string) => ({ kind: "work", id: `t:work:${status}`, status }) as never;
const interrupted = () => ({ kind: "system", id: "t:stop", systemKind: "operation", operationKind: "thread-interrupted", status: "complete" }) as never;
const systemError = () => ({ kind: "system", id: "t:err", systemKind: "error", status: "complete" }) as never;

test("indexOf: a turn in progress marks its question and its replies; a finished one marks neither", () => {
  const { messages } = indexOf([user(1), reply(1), user(2), reply(2), work("pending")], false);
  const byTitle = Object.fromEntries(messages.map((m) => [m.title, m.status]));
  assert.deepEqual(byTitle, { q1: undefined, a1: undefined, q2: "pending", a2: "pending" });
});

test("indexOf: a turn in progress with no reply yet still marks its question", () => {
  const { messages } = indexOf([user(1), reply(1), user(2), work("pending")], false);
  assert.equal(messages.find((m) => m.title === "q2")?.status, "pending");
  assert.equal(messages.find((m) => m.title === "q1")?.status, undefined);
});

test("indexOf: a failed turn marks only the reply; the question stays unmarked", () => {
  const { messages } = indexOf([user(1), reply(1), systemError()], false);
  assert.equal(messages.find((m) => m.title === "a1")?.status, "error");
  assert.equal(messages.find((m) => m.title === "q1")?.status, undefined);
});

test("indexOf: skips agent-initiated user messages", () => {
  const out = indexOf([user(1), reply(1), user(2, "from an agent", { initiator: "agent" }), user(3)], false);
  assert.deepEqual(out.messages.filter((m) => m.role === "user").map((m) => m.title), ["q1", "q3"]);
});

test("indexOf: an interrupted turn marks the reply, and a later reply clears it", () => {
  assert.equal(indexOf([user(1), reply(1), interrupted()], false).messages.find((m) => m.title === "a1")?.status, "interrupted");
  assert.equal(indexOf([user(1), reply(1), interrupted(), reply(2)], false).messages.find((m) => m.title === "a2")?.status, undefined);
});

test("indexOf: titles read mentions as their labels and drop BB's own tag", () => {
  const text = "[bb system] @thread:thr_x finished";
  const mention = { start: 12, end: 25, resource: { label: "Review thread" } };
  const { messages } = indexOf([user(1, text, { mentions: [mention], initiator: "system" })], false);
  assert.equal(messages[0]?.title, "Review thread finished");
  assert.equal(messages[0]?.by, "system");
});

test("indexOf: a message with no text is titled from its attachments", () => {
  const attach = (localFileDetails: { name: string }[], localImages = 0) => ({ attachments: { localFileDetails, localImages, webImages: 0, imageUrls: [] } });
  assert.equal(indexOf([user(1, "", attach([{ name: "a.png" }, { name: "b.pdf" }]))], false).messages[0]?.title, "a.png, b.pdf");
  assert.equal(indexOf([user(1, "", attach([], 1))], false).messages[0]?.title, "Image");
  assert.equal(indexOf([user(1, "", attach([], 3))], false).messages[0]?.title, "3 images");
  assert.equal(indexOf([user(1, "", attach([]))], false).messages.length, 0, "nothing to say, nothing named");
});

test("indexOf: a very long message still gets its line", () => {
  const long = `${"word ".repeat(5000)}`;
  const title = indexOf([user(1, long)], false).messages[0]!;
  assert.equal(title.title.length, 240);
  assert.equal(title.full.length, 800);
});

// Rows as the timeline gives them for the merge: an id and where in the thread's history they start.
const at = (id: string, sourceSeqStart: number, extra: object = {}) => ({ id, sourceSeqStart, kind: "work", ...extra }) as never;
const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id);

test("mergeNewest: older rows are kept, rows rewritten inside the window are dropped", () => {
  const held = [at("a", 1), at("b", 2), at("c", 3), at("gone", 4)];
  const merged = mergeNewest(held, [at("c", 3), at("d", 5)]);
  assert.deepEqual(ids(merged), ["a", "b", "c", "d"], "`gone` sat inside the new window and is not in it");
});

test("mergeNewest: updates replace older rows by id", () => {
  const held = [at("a", 1, { status: "pending" }), at("b", 2)];
  const merged = mergeNewest(held, [at("c", 5)], [at("a", 1, { status: "complete" })]) as { id: string; status?: string }[];
  assert.equal(merged.find((r) => r.id === "a")?.status, "complete");
  assert.deepEqual(ids(merged), ["a", "b", "c"]);
});

test("mergeNewest: an empty page means an empty thread", () => {
  assert.deepEqual(ids(mergeNewest([at("a", 1)], [])), []);
});

test("prependOlder: a page that overlaps what is held does not repeat rows", () => {
  assert.deepEqual(ids(prependOlder([at("c", 3), at("d", 4)], [at("a", 1), at("b", 2), at("c", 3)])), ["a", "b", "c", "d"]);
});

test("flatten: a turn's children follow it", () => {
  const turn = { kind: "turn", id: "turn", children: [{ kind: "work", id: "w" }] } as never;
  assert.deepEqual(ids(flatten([user(1), turn])), ["t:user-seed:1", "turn", "w"]);
});

test("rankOfRow: a row BB made up takes the rank of the nearest known row before it", () => {
  const rank = new Map([["t:user-seed:1", 0], ["t:work:1", 1]]);
  const dom = (id: string) => ({ dataset: { timelineRowId: id } }) as unknown as HTMLElement;
  const rows = [dom("t:user-seed:1"), dom("t:turn:work-summary:t:work:1"), dom("t:turn:unknown")];
  assert.equal(rankOfRow(rows, 0, rank), 0);
  assert.equal(rankOfRow(rows, 1, rank), 1, "a work-summary stands for the data row it names");
  assert.equal(rankOfRow(rows, 2, rank), 1, "an unknown row walks back to the one before it");
  assert.equal(rankOfRow(rows.slice(2), 0, rank), null, "nothing known at or above");
});

test("outlineOf: counts the messages the bar names, not another agent's or an empty one", () => {
  const item = (id: string, preview: string, attachmentSummary: { count: number } | null = null) => ({ id, preview, attachmentSummary }) as Parameters<typeof outlineOf>[0][number];
  const out = outlineOf([
    item("u1", "first"),
    item("u2", "[bb message from thread:thr_abc123] done"),
    item("u3", "[bb system] @thread:thr_x finished"),
    item("u4", ""),
    item("u5", "", { count: 1 }),
    item("u6", "[bb message from thread is just text"),
  ]);
  assert.deepEqual([...out.ordinals], [["u1", 1], ["u3", 2], ["u5", 3], ["u6", 4]]);
  assert.equal(out.total, 4);
});
