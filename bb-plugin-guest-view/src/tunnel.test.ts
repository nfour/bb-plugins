import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { tokenFromBytes } from "./model.ts";
import { isOurTunnel, startTunnel, stopLeftoverTunnel } from "./tunnel.ts";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((done) => setTimeout(done, 20));
  return check();
};

/** A directory with a script standing in for cloudflared. */
async function fake(body: string): Promise<{ dir: string; binary: string }> {
  const dir = await mkdtemp(join(tmpdir(), "gv-cloudflared-"));
  const binary = join(dir, "cloudflared");
  await writeFile(binary, `#!/bin/sh\n${body}\n`);
  await chmod(binary, 0o755);
  return { dir, binary };
}

test("isOurTunnel recognises this plugin's quick tunnel and nothing else", () => {
  assert.ok(isOurTunnel("/home/me/.local/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:41873"));
  assert.ok(isOurTunnel("cloudflared tunnel --url=http://127.0.0.1:80"));
  assert.ok(!isOurTunnel("cloudflared tunnel run my-named-tunnel"));
  assert.ok(!isOurTunnel("cloudflared access ssh --url http://127.0.0.1:22"));
  assert.ok(!isOurTunnel("node server.js --url http://127.0.0.1:3000 tunnel"));
  assert.ok(!isOurTunnel("cloudflared tunnel --url http://10.0.0.5:80"));
  assert.ok(!isOurTunnel(""));
});

test("startTunnel finds the address, and the log never gets the guest token", async () => {
  const token = tokenFromBytes(new Uint8Array(32).fill(9));
  const { dir, binary } = await fake(`
echo "INF |  https://quiet-fake-host.trycloudflare.com  |" >&2
echo "ERR Request failed dest=https://quiet-fake-host.trycloudflare.com/${token}/poll?since=3&client=0123456789abcdef01234567&name=Kind%20Wren" >&2
echo "INF Registered tunnel connection connIndex=0" >&2
exec sleep 600`);
  const lines: string[] = [];
  try {
    const tunnel = await startTunnel(binary, 4242, (line) => lines.push(line), 200);
    assert.equal(tunnel.url, "https://quiet-fake-host.trycloudflare.com");
    assert.ok(tunnel.pid && alive(tunnel.pid));
    assert.ok(lines.length >= 3);
    const all = lines.join("\n");
    assert.ok(!all.includes(token), "the token is not logged");
    assert.ok(!all.includes("client=0123"), "nor the guest's page id");
    assert.ok(!all.includes("Kind"), "nor the guest's name");
    assert.ok(all.includes("/<token>/poll"));
    await tunnel.stop();
    assert.ok(!alive(tunnel.pid!));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stop kills a cloudflared that ignores the polite request", async () => {
  const { dir, binary } = await fake(`
trap '' TERM
echo "INF https://stubborn-fake-host.trycloudflare.com" >&2
echo "INF Registered tunnel connection connIndex=0" >&2
while true; do sleep 1; done`);
  try {
    const tunnel = await startTunnel(binary, 4242, () => {}, 300);
    const pid = tunnel.pid!;
    const started = Date.now();
    await tunnel.stop();
    assert.ok(!alive(pid), "gone");
    assert.ok(Date.now() - started < 2500, "after the grace, not much later");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a leftover tunnel of ours is stopped; any other process with that id is left alone", async () => {
  // No exec: the shell stays the process, so its command line keeps the arguments a real cloudflared has.
  const { dir, binary } = await fake(`while true; do sleep 1; done`);
  const ours = spawn(binary, ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:9"], { stdio: "ignore" });
  const other = spawn("sleep", ["600"], { stdio: "ignore" });
  try {
    await new Promise((done) => setTimeout(done, 100));
    assert.equal(await stopLeftoverTunnel(other.pid, 300), false, "an unrelated process is not touched");
    assert.ok(alive(other.pid!));
    assert.equal(await stopLeftoverTunnel(undefined), false);
    assert.equal(await stopLeftoverTunnel(1), false);
    assert.equal(await stopLeftoverTunnel("123"), false);
    assert.equal(await stopLeftoverTunnel(ours.pid, 300), true);
    assert.ok(await until(() => !alive(ours.pid!)), "ours is gone");
    assert.equal(await stopLeftoverTunnel(ours.pid, 300), false, "a process that is gone is not an error");
  } finally {
    ours.kill("SIGKILL");
    other.kill("SIGKILL");
    await rm(dir, { recursive: true, force: true });
  }
});
