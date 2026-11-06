import assert from "node:assert/strict";
import { test } from "node:test";
import { cpuSeconds, rssMB, workerPlugin } from "./proc.ts";

test("the plugin is the second argument after the worker script", () => {
  const argv = ["node", "--use-system-ca", "/x/host-daemon/dist/bb-plugin-host-worker.mjs", "/h/browser-automation/abc/host.mjs", "browser-automation", "uuid"];
  assert.equal(workerPlugin(argv), "browser-automation");
  assert.equal(workerPlugin(["node", "/x/bb-provider-bridge-worker.mjs", "/h/provider-claude-code/z/host.mjs", "provider-claude-code"]), "provider-claude-code");
  assert.equal(workerPlugin(["node", "server.js"]), null);
  assert.equal(workerPlugin(["node", "/x/bb-plugin-host-worker.mjs"]), null);
});

test("cpu seconds read utime and stime past a command name with spaces", () => {
  const stat = "123 (node (worker)) S 1 2 3 4 5 6 7 8 9 10 250 50 0 0 20 0 1 0";
  assert.equal(cpuSeconds(stat), 3);
  assert.equal(cpuSeconds("garbage"), null);
});

test("rss comes from VmRSS in kB", () => {
  assert.equal(rssMB("Name:\tnode\nVmRSS:\t  2048 kB\n"), 2);
  assert.equal(rssMB("Name:\tnode\n"), null);
});
