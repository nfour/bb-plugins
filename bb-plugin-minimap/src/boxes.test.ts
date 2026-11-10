import assert from "node:assert/strict";
import { test } from "node:test";
import { TWEEN_MAX, boxesOf, paintList, type Box } from "./boxes.ts";
import type { Kind, Layout } from "./model.ts";

const ALL: Record<Kind, boolean> = { user: true, reply: true, work: true, error: true, system: true };

/** A layout of rows laid end to end. */
function layout(rows: { kind: Kind; h: number; w?: number }[]): Layout {
  const out: Layout = { ids: [], kinds: [], y: [], h: [], w: [], total: 0, bbs: [0], owns: [0] };
  let y = 0;
  rows.forEach((row, i) => {
    out.ids.push("r" + i);
    out.kinds.push(row.kind);
    out.y.push(y);
    out.h.push(row.h);
    out.w.push(row.w ?? 1);
    y += row.h;
  });
  out.total = y;
  return out;
}

test("a user message is right-aligned at its own width, a reply runs from the left edge", () => {
  const boxes = boxesOf(layout([{ kind: "user", h: 100, w: 0.5 }, { kind: "reply", h: 100 }]), 1, 40, 900, ALL, 1);
  const user = boxes.get("r0")!;
  const reply = boxes.get("r1")!;
  assert.equal(user.x + user.w, 38);
  assert.equal(Math.round(user.w), 19);
  assert.equal(reply.x, 0);
  assert.equal(reply.w, 38);
});

test("a kind that is switched off leaves no rectangle", () => {
  const boxes = boxesOf(layout([{ kind: "user", h: 50 }, { kind: "work", h: 50 }]), 1, 40, 900, { ...ALL, work: false }, 1);
  assert.deepEqual([...boxes.keys()], ["r0"]);
});

test("your messages and errors are never thinner than two device pixels", () => {
  const boxes = boxesOf(layout([{ kind: "user", h: 0.1 }, { kind: "error", h: 0.1 }, { kind: "reply", h: 0.1 }]), 1, 40, 900, ALL, 2);
  assert.equal(boxes.get("r0")!.h, 1);
  assert.equal(boxes.get("r1")!.h, 1);
  assert.equal(boxes.get("r2")!.h, 1, "any rectangle keeps at least one CSS pixel");
  const one = boxesOf(layout([{ kind: "user", h: 0.1 }]), 1, 40, 900, ALL, 1);
  assert.equal(one.get("r0")!.h, 2);
});

test("a sparse strip paints every rectangle, with your messages and errors last", () => {
  const boxes = boxesOf(layout([{ kind: "user", h: 40 }, { kind: "reply", h: 40 }, { kind: "error", h: 40 }, { kind: "work", h: 40 }]), 1, 40, 900, ALL, 1);
  const list = paintList(boxes.values(), 900, 1);
  assert.equal(list.length, 4);
  assert.deepEqual(list.map((b) => b.kind), ["reply", "work", "user", "error"]);
});

test("on a very long thread the work is bounded by the strip's rows, and every landmark is above the replies", () => {
  const rows: { kind: Kind; h: number; w?: number }[] = [];
  for (let i = 0; i < 4000; i++) rows.push({ kind: i % 10 === 0 ? "user" : "reply", h: 30, w: 0.3 + (i % 7) / 10 });
  const l = layout(rows);
  const height = 900;
  const dpr = 2;
  const boxes = boxesOf(l, height / l.total, 40, height, ALL, dpr);
  const list = paintList(boxes.values(), height, dpr);
  assert.ok(list.length <= 2 * height * dpr, `painted ${list.length}`);
  const lastReply = list.map((b) => b.kind).lastIndexOf("reply");
  const firstUser = list.map((b) => b.kind).indexOf("user");
  assert.ok(lastReply < firstUser, "a reply is never painted over a message");
  // Every device row that held a user message still has one.
  const want = new Set<number>();
  for (const [id, b] of boxes) if (b.kind === "user") want.add(Math.floor(b.y * dpr));
  const got = new Set(list.filter((b) => b.kind === "user").map((b) => Math.floor(b.y * dpr)));
  assert.deepEqual([...got].sort((a, b) => a - b), [...want].sort((a, b) => a - b));
});

test("in a device row the widest message is the one kept", () => {
  const a: Box = { kind: "user", x: 20, y: 10.1, w: 18, h: 2, a: 1 };
  const b: Box = { kind: "user", x: 5, y: 10.3, w: 33, h: 2, a: 1 };
  const list = paintList([a, b], 2, 1);
  assert.deepEqual(list, [b]);
});

test("more rectangles than the limit are not animated", () => {
  assert.ok(TWEEN_MAX >= 500 && TWEEN_MAX <= 5000);
});
