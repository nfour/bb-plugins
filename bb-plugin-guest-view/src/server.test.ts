// The plugin's backend, end to end: the real server.ts and the real guest HTTP server, with a fake `bb`
// (threads, storage, push) and a shell script standing in for cloudflared. No network, no BB.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import plugin, { type OwnerState } from "../server.ts";

const THREAD = "thr_test";
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const hex24 = () => randomBytes(12).toString("hex");
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (check: () => boolean | Promise<boolean>, ms = 3000) => {
  const end = Date.now() + ms;
  while (!(await check()) && Date.now() < end) await sleep(25);
  return check();
};

interface FakeThread {
  title: string;
  status: string;
  rows: Record<string, unknown>[];
  /** While above zero, reading the timeline fails (and counts down). */
  failReads: number;
}
interface Push {
  title: string;
  body: string;
  threadId: string;
}

/** Everything that outlives one load of the plugin: the folder, the stored state, the threads and the pushes. */
async function world() {
  const dir = await mkdtemp(join(tmpdir(), "gv-server-"));
  const binary = join(dir, "cloudflared");
  const calls = join(dir, "calls");
  await writeFile(
    binary,
    `#!/bin/sh
echo "$@" >> "${calls}"
echo "INF |  https://fake-$$.trycloudflare.com  |" >&2
echo "INF Registered tunnel connection connIndex=0" >&2
while true; do sleep 1; done
`,
  );
  await chmod(binary, 0o755);
  const kv = new Map<string, unknown>();
  const threads = new Map<string, FakeThread>([[THREAD, { title: "Test thread", status: "idle", rows: [], failReads: 0 }]]);
  const pushes: Push[] = [];
  const loaded: Loaded[] = [];

  async function load(): Promise<Loaded> {
    const handlers: Record<string, (input: any) => Promise<any>> = {};
    const listeners = new Map<string, ((event: any) => void)[]>();
    const logs: { level: string; message: string }[] = [];
    let disposeFn: () => Promise<void> = async () => {};
    const log = (level: string) => (message: string) => void logs.push({ level, message });
    const bb = {
      settings: { define: () => ({ get: async () => ({ expiryHours: 4, cloudflaredPath: binary }) }) },
      storage: {
        kv: {
          get: async (key: string) => kv.get(key) ?? null,
          set: async (key: string, value: unknown) => void kv.set(key, JSON.parse(JSON.stringify(value))),
          delete: async (key: string) => void kv.delete(key),
        },
      },
      log: { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") },
      realtime: { publish: () => {} },
      rpc: { register: (_contract: unknown, h: typeof handlers) => Object.assign(handlers, h) },
      events: { on: (name: string, fn: (event: unknown) => void) => void listeners.set(name, [...(listeners.get(name) ?? []), fn]) },
      onDispose: (fn: () => Promise<void>) => void (disposeFn = fn),
      sdk: {
        threads: {
          get: async ({ threadId }: { threadId: string }) => {
            const thread = threads.get(threadId);
            if (!thread) throw new Error("No such thread.");
            return { id: threadId, title: thread.title, status: thread.status, environmentId: null };
          },
          timeline: async ({ threadId }: { threadId: string }) => {
            const thread = threads.get(threadId)!;
            if (thread.failReads > 0) {
              thread.failReads -= 1;
              throw new Error("timeline is not ready");
            }
            return { rows: thread.rows };
          },
          defaultExecutionOptions: async () => ({ model: "m", reasoningLevel: "high" }),
        },
        providers: { models: async () => ({ models: [] }) },
        plugins: { callRpc: async ({ input }: { input: Push }) => void pushes.push(input) },
      },
    };
    await plugin(bb as unknown as BbPluginApi);
    const instance: Loaded = {
      logs,
      call: (method, input) => handlers[method]!(input),
      fire: (name, event) => listeners.get(name)?.forEach((fn) => fn(event)),
      dispose: () => disposeFn(),
      state: (threadId = THREAD) => handlers.state!({ threadId }) as Promise<OwnerState>,
      share: (via = "app") => handlers.share!({ threadId: THREAD, via }) as Promise<OwnerState>,
      async guestBase() {
        const text = await readFile(calls, "utf8");
        const port = /--url http:\/\/127\.0\.0\.1:(\d+)/.exec(text)?.[1];
        assert.ok(port, "cloudflared was started with the guest server's address");
        return `http://127.0.0.1:${port}`;
      },
      async cloudflaredStarts() {
        return (await readFile(calls, "utf8").catch(() => "")).split("\n").filter(Boolean).length;
      },
    };
    loaded.push(instance);
    return instance;
  }

  async function finish() {
    for (const instance of loaded) await instance.dispose().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
  return { dir, binary, kv, threads, pushes, load, finish };
}

interface Loaded {
  logs: { level: string; message: string }[];
  call(method: string, input: unknown): Promise<any>;
  fire(name: string, event: unknown): void;
  dispose(): Promise<void>;
  state(threadId?: string): Promise<OwnerState>;
  share(via?: string): Promise<OwnerState>;
  guestBase(): Promise<string>;
  cloudflaredStarts(): Promise<number>;
}

const tokenOf = (state: OwnerState) => state.share!.url.split("/").pop()!;
const message = (id: string, role: "user" | "assistant", text: string) => ({ id, kind: "conversation", role, text, initiator: "user" });

interface PollOptions {
  since?: number;
  ip?: string;
  name?: string;
  signal?: AbortSignal;
}
const poll = (base: string, token: string, client: string, { since = 0, ip = "203.0.113.1", name = "Ann", signal }: PollOptions = {}) =>
  fetch(`${base}/${token}/poll?since=${since}&client=${client}&name=${encodeURIComponent(name)}`, { headers: { "cf-connecting-ip": ip }, signal });
const submit = (base: string, token: string, body: Record<string, unknown>, ip = "203.0.113.1") =>
  fetch(`${base}/${token}/prompts`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify(body) });

const worlds: Awaited<ReturnType<typeof world>>[] = [];
after(async () => {
  for (const w of worlds) await w.finish();
});
async function fresh() {
  const w = await world();
  worlds.push(w);
  return w;
}

test("two share calls at once make one share and one tunnel", async () => {
  const w = await fresh();
  const gv = await w.load();
  const [a, b] = await Promise.all([gv.share(), gv.share()]);
  const state = await gv.state();
  assert.ok(state.share, "the thread is shared");
  assert.equal(await gv.cloudflaredStarts(), 1, "one tunnel");
  assert.equal(((await gv.call("shared", {})) as { shares: unknown[] }).shares.length, 1, "one share");
  assert.ok(a.share || b.share);
  assert.equal(w.pushes.length, 0, "started from the app, so nobody is told");
  assert.ok(!gv.logs.some((l) => l.level === "warn"));
  assert.ok(w.kv.has("state"), "the tunnel's process id and the shared thread are recorded");
});

test("a share started outside the app is logged and the owner is told", async () => {
  const w = await fresh();
  const gv = await w.load();
  const state = await gv.share("cli");
  assert.ok(state.share, "it still works");
  assert.equal(w.pushes.length, 1);
  assert.equal(w.pushes[0]!.title, "A guest link was started");
  assert.equal(w.pushes[0]!.threadId, THREAD);
  assert.ok(gv.logs.some((l) => l.level === "warn" && /outside the Guest View menu/.test(l.message)));
  const none = await gv.share(undefined as unknown as string);
  assert.ok(none.share);
  assert.equal(w.pushes.length, 1, "a share that exists already is not announced twice");
});

test("a thread that does not exist cannot be shared and says so", async () => {
  const w = await fresh();
  const gv = await w.load();
  const state = (await gv.call("share", { threadId: "thr_missing", via: "app" })) as OwnerState;
  assert.equal(state.share, null);
  assert.match(state.error ?? "", /No such thread/);
});

test("a page holds only a few waiting polls; the rest are answered, and stop ends the waiting ones", async () => {
  const w = await fresh();
  w.threads.get(THREAD)!.rows = [message("m1", "user", "hello")];
  const gv = await w.load();
  const token = tokenOf(await gv.share());
  const base = await gv.guestBase();
  const client = hex24();
  const first = await poll(base, token, client);
  assert.equal(first.status, 200);
  const data = (await first.json()) as { rev: number; items: unknown[]; you: string };
  assert.equal(data.items.length, 1);
  assert.equal(data.you, "Ann");

  const controller = new AbortController();
  const answered: number[] = [];
  const waiting = Array.from({ length: 10 }, (_, i) =>
    poll(base, token, client, { since: data.rev, signal: controller.signal })
      .then(async (r) => {
        answered.push(i);
        return (await r.json()) as { ended?: string; items: unknown[] };
      })
      .catch(() => null),
  );
  await sleep(400);
  assert.equal(answered.length, 7, "seven of ten were released at once, three still wait");

  await gv.call("stop", { threadId: THREAD });
  const rest = await Promise.all(waiting);
  assert.equal(answered.length, 10, "stopping answered the waiting ones too");
  assert.equal(rest.filter((r) => r?.ended === "revoked").length, 3, "and told them the share ended");
  const late = await poll(base, token, hex24());
  assert.equal(late.status, 404, "the link is dead after stop");
  controller.abort();
});

test("one address cannot fill the share with pages of its own", async () => {
  const w = await fresh();
  const gv = await w.load();
  const token = tokenOf(await gv.share());
  const base = await gv.guestBase();
  for (let i = 0; i < 5; i += 1) assert.equal((await poll(base, token, hex24(), { ip: "198.51.100.7", name: `Guest ${i}` })).status, 200);
  const sixth = await poll(base, token, hex24(), { ip: "198.51.100.7" });
  assert.equal(sixth.status, 429);
  const body = (await sixth.json()) as { retry: boolean; error: string };
  assert.equal(body.retry, true, "the page is told to try again, not to give up");
  assert.match(body.error, /Too many pages/);
  assert.equal((await poll(base, token, hex24(), { ip: "198.51.100.8" })).status, 200, "another address is fine");
});

test("a prompt needs a page the share has seen; a removed page cannot send or read", async () => {
  const w = await fresh();
  const gv = await w.load();
  const token = tokenOf(await gv.share());
  const base = await gv.guestBase();
  const client = hex24();

  const without = await submit(base, token, { text: "hi" });
  assert.equal(without.status, 400);
  assert.match(((await without.json()) as { error: string }).error, /Reload the page/);
  assert.equal((await submit(base, token, { text: "hi", clientId: hex24() })).status, 400, "a well formed id the share never saw");
  assert.equal((await submit(base, token, { text: "hi", clientId: "../../x" })).status, 400);
  assert.equal(((await gv.state()).prompts).length, 0);

  await poll(base, token, client, { name: "Lydia" });
  const sent = await submit(base, token, { text: "rename the button", clientId: client, name: "Owner" });
  assert.equal(sent.status, 201);
  const state = await gv.state();
  assert.equal(state.prompts.length, 1);
  assert.equal(state.prompts[0]!.text, "rename the button");
  assert.equal(state.prompts[0]!.name, "Lydia", "a guest who tried to send as the owner keeps the name they have");

  const guestId = state.share!.guests[0]!.id;
  assert.equal(guestId, client);
  await gv.call("kick", { threadId: THREAD, guestId });
  const kickedSend = await submit(base, token, { text: "again", clientId: client });
  assert.equal(kickedSend.status, 403);
  const kickedRead = (await (await poll(base, token, client)).json()) as { ended?: string };
  assert.equal(kickedRead.ended, "kicked");
  const noId = await submit(base, token, { text: "sneaky" });
  assert.equal(noId.status, 400, "leaving the page id out is no way around a removal");
});

test("many prompts make one push at once and one summary later", async () => {
  const w = await fresh();
  const gv = await w.load();
  const token = tokenOf(await gv.share());
  const base = await gv.guestBase();
  const client = hex24();
  await poll(base, token, client);
  for (let i = 0; i < 5; i += 1) assert.equal((await submit(base, token, { text: `idea ${i}`, clientId: client })).status, 201);
  assert.equal((await submit(base, token, { text: "one too many", clientId: client })).status, 429, "five a minute from one address");
  assert.equal(w.pushes.length, 1, "the first prompt was told at once, the rest wait for the summary");
  assert.match(w.pushes[0]!.title, /suggested a prompt/);
  await gv.call("stop", { threadId: THREAD });
});

test("a failed first read is not a starting point: a guest who may not see history sees nothing of it", async () => {
  const w = await fresh();
  const thread = w.threads.get(THREAD)!;
  thread.rows = [message("m1", "user", "earlier"), message("m2", "assistant", "an earlier answer")];
  const gv = await w.load();
  thread.failReads = 100; // the read the share starts with fails too, so the feed is not ready when guests arrive
  const token = tokenOf(await gv.share());
  const base = await gv.guestBase();
  await gv.call("configure", { threadId: THREAD, showHistory: false });

  const early = (await (await poll(base, token, hex24(), { name: "Early" })).json()) as { rev: number; items: unknown[] };
  assert.equal(early.rev, 0);
  assert.deepEqual(early.items, []);

  thread.failReads = 0;
  const client = hex24();
  const second = (await (await poll(base, token, client, { name: "Later" })).json()) as { rev: number; items: { id: string }[] };
  assert.ok(second.rev > 0);
  assert.deepEqual(second.items, [], "what was said before the guest came stays unseen");

  thread.rows.push(message("m3", "assistant", "a new answer"));
  const next = poll(base, token, client, { since: second.rev, name: "Later" }).then((r) => r.json()) as Promise<{ items: { id: string }[] }>;
  await sleep(100);
  gv.fire("experimental_thread.events", { thread: { id: THREAD } });
  const got = await next;
  assert.deepEqual(got.items.map((i) => i.id), ["m3"], "and what is said after arrives");
});

test("the link record survives a reload: the next load tells the owner the link ended", async () => {
  const w = await fresh();
  const gv = await w.load();
  await gv.share();
  assert.ok(w.kv.has("state"));
  await gv.dispose();
  assert.ok(w.kv.has("state"), "a reload does not clear the record");
  const again = await w.load();
  assert.ok(await until(async () => Boolean((await again.state()).error)), "the card gets an error");
  assert.match((await again.state()).error!, /restarted or reloaded/);
  assert.equal((await again.state()).share, null);
  assert.ok(!w.kv.has("state"), "and the record is used up");
});

test("a cloudflared left over from a dead run is stopped, and a stranger's process is not", async () => {
  const w = await fresh();
  const stranger = spawn("sleep", ["600"], { stdio: "ignore" });
  const ours = spawn(w.binary, ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:9"], { stdio: "ignore" });
  try {
    await sleep(100);
    w.kv.set("state", { pid: stranger.pid, live: [] });
    await w.load();
    await sleep(300);
    assert.ok(alive(stranger.pid!), "an id that now belongs to something else is left alone");

    w.kv.set("state", { pid: ours.pid, live: [THREAD] });
    const gv = await w.load();
    assert.ok(await until(() => !alive(ours.pid!), 5000), "ours is stopped");
    assert.ok(await until(async () => Boolean((await gv.state()).error)));
  } finally {
    stranger.kill("SIGKILL");
    ours.kill("SIGKILL");
  }
});

test("stopping the last share stops cloudflared", async () => {
  const w = await fresh();
  const gv = await w.load();
  await gv.share();
  const record = w.kv.get("state") as { pid: number };
  assert.ok(alive(record.pid));
  await gv.call("stop", { threadId: THREAD });
  assert.ok(await until(() => !alive(record.pid), 6000), "after a short grace for the pages to hear it");
  assert.ok(await until(() => !w.kv.has("state"), 3000), "and the record is cleared");
});
