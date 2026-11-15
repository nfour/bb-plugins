// The merge-base logic in server.ts, end to end: the real server.ts with a fake `bb` (kv, environments,
// the Git plugin's setMergeBase) and a real throwaway git repository for `git log`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import plugin from "../server.ts";

const ENV = "env_test";
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();

/** A repository with `commits` commits, oldest first: c1 is the root. Returns the shas newest first. */
async function repo(commits: number) {
  const dir = await mkdtemp(join(tmpdir(), "dp-server-"));
  git(dir, "init", "-q");
  for (let i = 1; i <= commits; i++) git(dir, "commit", "-q", "--allow-empty", "-m", `c${i}`);
  const shas = git(dir, "log", "--format=%H").split("\n");
  return { dir, shas };
}

interface Handlers {
  [method: string]: (input: any) => Promise<any>;
}

/** Everything that outlives one load of the plugin: the stored records, the environment and the calls made. */
function world(path: string, mergeBaseBranch: string | null = null) {
  const kv = new Map<string, unknown>();
  const environment = { id: ENV, path, mergeBaseBranch, defaultBranch: "main" };
  const setCalls: (string | null)[] = [];
  const logs: { level: string; message: string }[] = [];
  /** Held back until released, to make two calls overlap. */
  let gate: Promise<void> | null = null;
  let failSet = false;

  async function load() {
    const handlers: Handlers = {};
    let disposeFn: () => Promise<void> = async () => {};
    const log = (level: string) => (message: string) => void logs.push({ level, message });
    const bb = {
      storage: {
        kv: {
          get: async (key: string) => (kv.has(key) ? structuredClone(kv.get(key)) : null),
          set: async (key: string, value: unknown) => void kv.set(key, structuredClone(value)),
          delete: async (key: string) => void kv.delete(key),
          list: async (prefix: string) => [...kv.keys()].filter((key) => key.startsWith(prefix)),
        },
      },
      log: { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") },
      rpc: { register: (_contract: unknown, h: Handlers) => Object.assign(handlers, h) },
      onDispose: (fn: () => Promise<void>) => void (disposeFn = fn),
      sdk: {
        environments: { get: async () => ({ ...environment }) },
        plugins: {
          callRpc: async ({ method, input }: { method: string; input: { mergeBaseBranch: string | null } }) => {
            if (method !== "setMergeBase") throw new Error(`unexpected call ${method}`);
            await gate;
            if (failSet) throw new Error("git plugin is down");
            setCalls.push(input.mergeBaseBranch);
            environment.mergeBaseBranch = input.mergeBaseBranch;
            return { ok: true };
          },
        },
      },
    };
    await plugin(bb as unknown as BbPluginApi);
    // The startup restore runs in the background; let it finish.
    await new Promise((done) => setTimeout(done, 30));
    return { call: (method: string, input: unknown) => handlers[method]!(input), dispose: () => disposeFn() };
  }
  return {
    kv,
    environment,
    setCalls,
    logs,
    load,
    hold: () => {
      let release!: () => void;
      gate = new Promise<void>((resolve) => (release = resolve));
      return () => {
        gate = null;
        release();
      };
    },
    failSets: (on: boolean) => (failSet = on),
  };
}

const dirs: string[] = [];
after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});
async function fresh(commits: number, base: string | null = null) {
  const r = await repo(commits);
  dirs.push(r.dir);
  return { ...r, w: world(r.dir, base) };
}

test("recent_commits lists the newest commits and leaves out the root", async () => {
  const { w, shas } = await fresh(5);
  const dp = await w.load();
  const three = await dp.call("recent_commits", { environmentId: ENV, count: 3 });
  assert.equal(three.ok, true);
  assert.deepEqual(three.commits.map((c: { sha: string }) => c.sha), shas.slice(0, 3));
  assert.deepEqual(three.commits.map((c: { subject: string }) => c.subject), ["c5", "c4", "c3"]);
  assert.equal(three.commits[0].shortSha, shas[0]!.slice(0, three.commits[0].shortSha.length));
  // More than the history holds: every commit with a parent, so not c1.
  const many = await dp.call("recent_commits", { environmentId: ENV, count: 50 });
  assert.deepEqual(many.commits.map((c: { subject: string }) => c.subject), ["c5", "c4", "c3", "c2"]);
});

test("show_recent moves the base count commits back, keeps a record, and restore_base puts it back", async () => {
  const { w, shas } = await fresh(6, "main");
  const dp = await w.load();
  const shown = await dp.call("show_recent", { environmentId: ENV, count: 2 });
  assert.deepEqual(shown, { ok: true, moved: true });
  assert.equal(w.environment.mergeBaseBranch, shas[2], "the base is the commit just below the two shown");
  assert.deepEqual(w.kv.get(`recent:${ENV}`), { previous: "main", sha: shas[2] });
  const back = await dp.call("restore_base", { environmentId: ENV, reason: "scope" });
  assert.deepEqual(back, { ok: true, moved: true });
  assert.equal(w.environment.mergeBaseBranch, "main");
  assert.ok(!w.kv.has(`recent:${ENV}`), "the record is gone");
  assert.ok(w.logs.some((l) => l.level === "info" && l.message.includes("base moved")));
  assert.ok(w.logs.some((l) => l.level === "info" && l.message.includes("base restored") && l.message.includes("(scope)")));
});

test("a second pick keeps the original base, not the first pick's", async () => {
  const { w, shas } = await fresh(8, null);
  const dp = await w.load();
  await dp.call("show_recent", { environmentId: ENV, count: 2 });
  await dp.call("show_recent", { environmentId: ENV, count: 4 });
  assert.equal(w.environment.mergeBaseBranch, shas[4]);
  assert.equal((w.kv.get(`recent:${ENV}`) as { previous: string | null }).previous, null);
  await dp.call("restore_base", { environmentId: ENV, reason: "scope" });
  assert.equal(w.environment.mergeBaseBranch, null, "back to the default");
});

test("show_recent beyond the history bases on the first commit", async () => {
  const { w, shas } = await fresh(3, "main");
  const dp = await w.load();
  const shown = await dp.call("show_recent", { environmentId: ENV, count: 50 });
  assert.equal(shown.ok, true);
  assert.equal(w.environment.mergeBaseBranch, shas.at(-1));
});

test("show_recent on a base that is already there does not write", async () => {
  const { w, shas } = await fresh(5, null);
  w.environment.mergeBaseBranch = shas[2]!;
  const dp = await w.load();
  const shown = await dp.call("show_recent", { environmentId: ENV, count: 2 });
  assert.deepEqual(shown, { ok: true, moved: false });
  assert.equal(w.setCalls.length, 0);
  assert.ok(!w.kv.has(`recent:${ENV}`));
});

test("restore_base with no record does nothing", async () => {
  const { w } = await fresh(3, "main");
  const dp = await w.load();
  assert.deepEqual(await dp.call("restore_base", { environmentId: ENV, reason: "scope" }), { ok: true, moved: false });
  assert.equal(w.setCalls.length, 0);
});

test("a base changed elsewhere drops the record and is left alone", async () => {
  const { w } = await fresh(6, "main");
  const dp = await w.load();
  await dp.call("show_recent", { environmentId: ENV, count: 2 });
  w.environment.mergeBaseBranch = "release"; // the user picked another base in BB
  const before = w.setCalls.length;
  assert.deepEqual(await dp.call("restore_base", { environmentId: ENV, reason: "scope" }), { ok: true, moved: false });
  assert.equal(w.environment.mergeBaseBranch, "release", "not overwritten");
  assert.equal(w.setCalls.length, before);
  assert.ok(!w.kv.has(`recent:${ENV}`), "the stale record is dropped");
  assert.ok(w.logs.some((l) => l.message.includes("changed elsewhere")));
});

test("a failed move leaves no record behind", async () => {
  const { w } = await fresh(6, "main");
  const dp = await w.load();
  w.failSets(true);
  const shown = await dp.call("show_recent", { environmentId: ENV, count: 2 });
  assert.equal(shown.ok, false);
  assert.match(shown.message, /git plugin is down/);
  assert.ok(!w.kv.has(`recent:${ENV}`), "the record written first is rolled back");
  assert.equal(w.environment.mergeBaseBranch, "main");
  assert.ok(w.logs.some((l) => l.level === "warn"));
});

test("a failed move keeps the record of an earlier one", async () => {
  const { w, shas } = await fresh(8, "main");
  const dp = await w.load();
  await dp.call("show_recent", { environmentId: ENV, count: 2 });
  w.failSets(true);
  const shown = await dp.call("show_recent", { environmentId: ENV, count: 4 });
  assert.equal(shown.ok, false);
  assert.deepEqual(w.kv.get(`recent:${ENV}`), { previous: "main", sha: shas[2] }, "the first pick can still be put back");
  w.failSets(false);
  await dp.call("restore_base", { environmentId: ENV, reason: "scope" });
  assert.equal(w.environment.mergeBaseBranch, "main");
});

test("calls on one environment run one at a time", async () => {
  const { w, shas } = await fresh(8, "main");
  const dp = await w.load();
  const release = w.hold();
  const first = dp.call("show_recent", { environmentId: ENV, count: 2 });
  const second = dp.call("restore_base", { environmentId: ENV, reason: "scope" });
  await new Promise((done) => setTimeout(done, 100));
  assert.equal(w.setCalls.length, 0, "both wait on the first write");
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, { ok: true, moved: true });
  assert.deepEqual(b, { ok: true, moved: true }, "the restore saw the first call's record");
  assert.deepEqual(w.setCalls, [shas[2], "main"]);
  assert.equal(w.environment.mergeBaseBranch, "main");
});

test("startup puts back a base an earlier run left moved", async () => {
  const { w, shas } = await fresh(6, "main");
  const first = await w.load();
  await first.call("show_recent", { environmentId: ENV, count: 2 });
  assert.equal(w.environment.mergeBaseBranch, shas[2], "left moved, as after a crash");
  await w.load(); // a new run of the plugin
  assert.equal(w.environment.mergeBaseBranch, "main");
  assert.ok(!w.kv.has(`recent:${ENV}`));
  assert.ok(w.logs.some((l) => l.message.includes("(startup)")));
});

test("dispose puts every base back", async () => {
  const { w } = await fresh(6, "main");
  const dp = await w.load();
  await dp.call("show_recent", { environmentId: ENV, count: 2 });
  await dp.dispose();
  assert.equal(w.environment.mergeBaseBranch, "main");
  assert.ok(w.logs.some((l) => l.message.includes("(dispose)")));
});

test("an environment with no folder reports an error instead of throwing", async () => {
  const { w } = await fresh(3, "main");
  w.environment.path = "" as string;
  const dp = await w.load();
  const shown = await dp.call("show_recent", { environmentId: ENV, count: 2 });
  assert.equal(shown.ok, false);
  assert.match(shown.message, /no folder/);
  const commits = await dp.call("recent_commits", { environmentId: ENV, count: 2 });
  assert.equal(commits.ok, false);
});
