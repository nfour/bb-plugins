import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createWriter, dayOf, expired } from "./jsonl.ts";

const T = new Date(2026, 10, 2, 12, 0, 0).getTime();
const header = () => ({ t: T, kind: "targets" });

test("a day's file is named by local date", () => {
  assert.equal(dayOf(T), "2026-11-02");
});

test("expired lists only metrics files older than the retention", () => {
  const names = ["2026-10-01.jsonl", "2026-10-20.jsonl", "2026-11-02.jsonl", "notes.txt", "2026-10-19.jsonl.tmp"];
  assert.deepEqual(expired(names, T, 14), ["2026-10-01.jsonl"]);
});

test("append opens a new file with the targets line, then only adds lines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "perf-"));
  try {
    const w = createWriter(dir);
    assert.equal(await w.append([{ t: T, kind: "window" } as { t: number }], header), 1);
    assert.equal(await w.append([{ t: T + 1, kind: "slow" } as { t: number }], header), 1);
    const lines = (await readFile(join(dir, "2026-11-02.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.kind), ["targets", "window", "slow"]);
    assert.equal((await w.recent(2, T)).length, 2);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("lines of different days go to their own files and prune drops the old ones", async () => {
  const dir = await mkdtemp(join(tmpdir(), "perf-"));
  try {
    const w = createWriter(dir);
    const yesterday = T - 86_400_000;
    await w.append([{ t: yesterday }, { t: T }], header);
    assert.deepEqual((await readdir(dir)).sort(), ["2026-11-01.jsonl", "2026-11-02.jsonl"]);
    await writeFile(join(dir, "2026-09-01.jsonl"), "{}\n");
    assert.deepEqual(await w.prune(T), ["2026-09-01.jsonl"]);
    assert.deepEqual((await readdir(dir)).sort(), ["2026-11-01.jsonl", "2026-11-02.jsonl"]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("recent skips a half-written last line and a missing file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "perf-"));
  try {
    const w = createWriter(dir);
    assert.deepEqual(await w.recent(5, T), []);
    await writeFile(join(dir, "2026-11-02.jsonl"), '{"a":1}\n{"b":');
    assert.deepEqual(await w.recent(5, T), [{ a: 1 }]);
  } finally {
    await rm(dir, { recursive: true });
  }
});
