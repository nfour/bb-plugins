import assert from "node:assert/strict";
import { test } from "node:test";
import { startGuestServer, type GuestRoutes, type GuestServer } from "./http.ts";
import { tokenFromBytes } from "./model.ts";

const TOKEN = tokenFromBytes(new Uint8Array(32).fill(5));
const CLIENT = "0123456789abcdef01234567";

interface Calls {
  polls: { shareId: string; since: number; client: string; name: string; ip: string; waitMs: number }[];
  submits: { shareId: string; body: unknown; ip: string }[];
}

async function withServer(run: (base: string, calls: Calls, server: GuestServer) => Promise<void>, over: Partial<GuestRoutes> = {}) {
  const calls: Calls = { polls: [], submits: [] };
  const routes: GuestRoutes = {
    find: (token) => (token === TOKEN ? { id: "share-1", suggestedName: "Quiet Otter", maxChars: 4000 } : null),
    poll: async (shareId, since, client, name, ip, waitMs) => {
      calls.polls.push({ shareId, since, client, name, ip, waitMs });
      return { status: 200, body: { rev: since + 1, items: [] } };
    },
    submit: async (shareId, body, ip) => {
      calls.submits.push({ shareId, body, ip });
      return { status: 201, body: { id: "p1" } };
    },
    ...over,
  };
  const errors: unknown[] = [];
  const server = await startGuestServer(routes, (error) => errors.push(error));
  try {
    await run(`http://127.0.0.1:${server.port}`, calls, server);
  } finally {
    await server.close();
  }
  return errors;
}

const post = (url: string, body: string, type = "application/json") => fetch(url, { method: "POST", headers: { "content-type": type }, body });

test("a wrong token, a wrong path and a wrong method are the same 404", async () => {
  await withServer(async (base) => {
    const seen = new Set<string>();
    for (const [path, method] of [
      ["/", "GET"],
      ["/short", "GET"],
      [`/${"B".repeat(43)}`, "GET"],
      [`/${"B".repeat(43)}/poll?since=0&client=${CLIENT}`, "GET"],
      [`/${TOKEN}/other`, "GET"],
      [`/${TOKEN}/poll/extra`, "GET"],
      [`/${TOKEN}`, "POST"],
      [`/${TOKEN}/poll`, "POST"],
      [`/${TOKEN}/prompts`, "GET"],
      [`/${TOKEN}/prompts`, "DELETE"],
      ["/api/v1/threads", "GET"],
    ] as const) {
      const response = await fetch(base + path, { method });
      assert.equal(response.status, 404, `${method} ${path}`);
      seen.add(await response.text());
    }
    assert.equal(seen.size, 1, "one body for all of them");
  });
});

test("the page comes with a nonce policy and no caching or framing", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/${TOKEN}`);
    assert.equal(response.status, 200);
    const policy = response.headers.get("content-security-policy") ?? "";
    const nonce = /script-src 'nonce-([^']+)'/.exec(policy)?.[1];
    assert.ok(nonce, "the script policy names a nonce");
    assert.match(policy, /default-src 'none'/);
    assert.match(policy, /connect-src 'self'/);
    assert.match(policy, /frame-ancestors 'none'/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    const html = await response.text();
    assert.ok(html.includes(`nonce="${nonce}"`));
    const again = await fetch(`${base}/${TOKEN}`);
    assert.notEqual(/script-src 'nonce-([^']+)'/.exec(again.headers.get("content-security-policy") ?? "")?.[1], nonce, "a new nonce each time");
    const head = await fetch(`${base}/${TOKEN}`, { method: "HEAD" });
    assert.equal(head.status, 200);
  });
});

test("a poll with bad parameters is a 400 and never reaches the share", async () => {
  await withServer(async (base, calls) => {
    for (const query of ["", `since=x&client=${CLIENT}`, `since=1.5&client=${CLIENT}`, "since=0&client=short", `since=0&client=${"G".repeat(24)}`, `since=${"9".repeat(30)}&client=${CLIENT}`, `since=0&client=${CLIENT}0`]) {
      const response = await fetch(`${base}/${TOKEN}/poll?${query}`);
      assert.equal(response.status, 400, query);
    }
    assert.equal(calls.polls.length, 0);
  });
});

test("a poll passes its parameters on, and the address comes from Cloudflare's header", async () => {
  await withServer(async (base, calls) => {
    const response = await fetch(`${base}/${TOKEN}/poll?since=3&client=${CLIENT}&name=Kind%20Wren`, { headers: { "cf-connecting-ip": "203.0.113.9" } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { rev: 4, items: [] });
    assert.deepEqual(calls.polls[0], { shareId: "share-1", since: 3, client: CLIENT, name: "Kind Wren", ip: "203.0.113.9", waitMs: 25_000 });
    await fetch(`${base}/${TOKEN}/poll?since=0&client=${CLIENT}`);
    assert.match(calls.polls[1]!.ip, /127\.0\.0\.1/, "without the header, the socket's address");
    await fetch(`${base}/${TOKEN}/poll?since=0&client=${CLIENT}`, { headers: { "cf-connecting-ip": "x".repeat(200) } });
    assert.match(calls.polls[2]!.ip, /127\.0\.0\.1/, "a header that is too long is ignored");
  });
});

test("a waiting poll sees the connection close", async () => {
  let signal: AbortSignal | undefined;
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => (release = resolve));
  await withServer(
    async (base) => {
      const controller = new AbortController();
      const pending = fetch(`${base}/${TOKEN}/poll?since=0&client=${CLIENT}`, { signal: controller.signal }).catch(() => null);
      await waiting;
      assert.equal(signal!.aborted, false);
      controller.abort();
      await pending;
      for (let i = 0; i < 50 && !signal!.aborted; i += 1) await new Promise((done) => setTimeout(done, 20));
      assert.equal(signal!.aborted, true, "the share is told, so it can free the place");
    },
    {
      poll: async (_shareId, _since, _client, _name, _ip, _waitMs, closed) => {
        signal = closed;
        release();
        await new Promise<void>((done) => closed.addEventListener("abort", () => done()));
        return { status: 200, body: {} };
      },
    },
  );
});

test("prompts need JSON, bounded, well formed", async () => {
  await withServer(async (base, calls) => {
    const url = `${base}/${TOKEN}/prompts`;
    assert.equal((await post(url, "text", "text/plain")).status, 415);
    assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 415, "no content type at all");
    assert.equal((await post(url, "{not json")).status, 400);
    assert.equal((await post(url, JSON.stringify({ text: "x".repeat(40_000) }))).status, 413);
    assert.equal(calls.submits.length, 0, "none of those reached the share");
    const ok = await post(url, JSON.stringify({ name: "Ann", text: "hello", clientId: CLIENT }));
    assert.equal(ok.status, 201);
    assert.deepEqual(calls.submits[0], { shareId: "share-1", body: { name: "Ann", text: "hello", clientId: CLIENT }, ip: calls.submits[0]!.ip });
  });
});

test("an error in the share's code is a plain 500 that tells nothing", async () => {
  const errors = await withServer(
    async (base) => {
      const response = await fetch(`${base}/${TOKEN}/poll?since=0&client=${CLIENT}`);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: "Something went wrong." });
    },
    {
      poll: async () => {
        throw new Error("secret detail");
      },
    },
  );
  assert.equal(errors.length, 1, "the owner's log hears about it");
});
