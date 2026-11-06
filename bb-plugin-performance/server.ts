// bb-plugin-performance — backend entry.
//
// The page does the measuring (src/collector.ts) and hands over batches here.
// This side appends them to the day's JSONL file, keeps the last few hundred
// lines in memory for the dashboard, and samples what only the server can see:
// event-loop delay, CPU and memory of BB's server process (plugin back-ends run
// inside it, so it cannot be split per plugin) and, where /proc exists, the
// processes of plugins that have a host entry. Handler counts per plugin come
// from the page, which reads them off BB's own plugin list.
import { readdir } from "node:fs/promises";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { join } from "node:path";
import { cliCommand, defineCli, defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createWriter } from "./src/jsonl.ts";
import { measures, mergeWindows, TARGETS, worstGap, type Line, type ServerLine, type TargetsLine, type WindowLine } from "./src/model.ts";
import { findWorkers, readWorker, type Reading } from "./src/proc.ts";

/** The boolean settings the page can switch. */
export const SETTING_KEYS = ["enabled", "writeFile", "sampleServer"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

const SAMPLE_MS = 60_000;
const RING = 400;
const MAX_LINES = 200;

const lineSchema = z.looseObject({
  v: z.literal(1),
  t: z.number().finite(),
  kind: z.enum(["window", "slow", "nav", "start", "css", "mark", "bench", "probe"]),
  session: z.string().max(40),
});

const handlerSchema = z.object({
  id: z.string().max(80),
  version: z.string().max(40).nullable(),
  calls: z.number().finite(),
  maxMs: z.number().finite(),
  errors: z.number().finite(),
});

export const rpcContract = defineRpcContract({
  set_setting: { input: z.object({ key: z.enum(SETTING_KEYS), value: z.boolean() }), output: z.null() },
  ingest: {
    input: z.object({
      lines: z.array(lineSchema).max(MAX_LINES),
      bb: z.string().max(40).nullable(),
      plugins: z.array(handlerSchema).max(400),
    }),
    output: z.object({ written: z.number() }),
  },
  recent_threads: {
    input: z.object({ limit: z.number().int().min(2).max(12) }),
    output: z.object({ ids: z.array(z.string()) }),
  },
  snapshot: {
    input: z.object({}),
    output: z.object({
      recent: z.array(z.looseObject({ kind: z.string() })),
      server: z.looseObject({ kind: z.literal("server") }).nullable(),
      dir: z.string(),
      files: z.number(),
      lastWriteError: z.string().nullable(),
    }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    enabled: {
      type: "boolean",
      label: "Measure",
      description: "Observe frames, typing, thread switches and start in the page and write the numbers. Off, nothing is attached.",
      default: true,
    },
    writeFile: {
      type: "boolean",
      label: "Write the metrics file",
      description: "Append the numbers to a JSONL file per day under the plugin's folder, kept for 14 days.",
      default: true,
    },
    sampleServer: {
      type: "boolean",
      label: "Sample the server",
      description: "Once a minute, read the server process's event-loop delay, CPU and memory, and the processes of plugins with a host entry.",
      default: true,
    },
  });

  const dir = join(bb.server.experimental_dataDir, "plugins", bb.pluginId, "metrics");
  const writer = createWriter(dir);
  const recentLines: Line[] = [];
  let latestServer: ServerLine | null = null;
  let versions: Record<string, string> = {};
  let bbVersion: string | null = null;
  let lastWriteError: string | null = null;

  /** Handler counters as last seen from the page, and the change since the last server line. */
  const seen = new Map<string, { calls: number; errors: number }>();
  const pending = new Map<string, { calls: number; maxMs: number; errors: number }>();

  const header = (): TargetsLine => ({ v: 1, t: Date.now(), kind: "targets", bb: bbVersion, plugins: versions, targets: TARGETS });

  const keep = (line: Line) => {
    if (line.kind === "targets") return;
    recentLines.push(line);
    if (recentLines.length > RING) recentLines.splice(0, recentLines.length - RING);
  };

  const write = async (lines: Line[]) => {
    for (const line of lines) keep(line);
    if (!(await settings.get()).writeFile) return 0;
    try {
      const n = await writer.append(lines, header);
      lastWriteError = null;
      return n;
    } catch (error) {
      lastWriteError = error instanceof Error ? error.message : String(error);
      bb.log.warn(`could not write metrics: ${lastWriteError}`);
      return 0;
    }
  };

  bb.rpc.register(rpcContract, {
    set_setting: async ({ key, value }) => {
      await settings.experimental_set({ [key]: value });
      return null;
    },
    ingest: async ({ lines, bb: version, plugins }) => {
      if (version) bbVersion = version;
      versions = Object.fromEntries(plugins.filter((p) => p.version).map((p) => [p.id, p.version as string]));
      for (const p of plugins) {
        const before = seen.get(p.id);
        seen.set(p.id, { calls: p.calls, errors: p.errors });
        // Counters only grow; a smaller one means the plugin was removed and added again, so it is a new baseline.
        if (!before || p.calls < before.calls) continue;
        const calls = p.calls - before.calls;
        const errors = Math.max(0, p.errors - before.errors);
        if (calls === 0 && errors === 0) continue;
        const into = pending.get(p.id) ?? { calls: 0, maxMs: 0, errors: 0 };
        into.calls += calls;
        into.errors += errors;
        into.maxMs = Math.max(into.maxMs, p.maxMs);
        pending.set(p.id, into);
      }
      const written = await write(lines as unknown as Line[]);
      return { written };
    },
    // Ids only, for the thread-switch benchmark: no title or content leaves the server.
    recent_threads: async ({ limit }) => {
      const threads = await bb.sdk.threads.list({ limit });
      return { ids: threads.map((thread) => thread.id) };
    },
    snapshot: async () => {
      const files = (await readdir(dir).catch(() => [])).length;
      return { recent: recentLines as never, server: latestServer as never, dir, files, lastWriteError };
    },
  });

  // --- the server sample, once a minute -------------------------------------------------

  const loop = monitorEventLoopDelay({ resolution: 20 });
  let sampling = false;
  let lastCpu = process.cpuUsage();
  let lastAt = performance.now();
  const lastWorker = new Map<number, Reading>();

  const sample = async () => {
    const wanted = (await settings.get()).sampleServer;
    if (wanted && !sampling) {
      loop.enable();
      sampling = true;
      loop.reset();
      lastCpu = process.cpuUsage();
      lastAt = performance.now();
      return;
    }
    if (!wanted) {
      if (sampling) loop.disable();
      sampling = false;
      return;
    }
    const now = performance.now();
    const elapsed = (now - lastAt) / 1000;
    const cpu = process.cpuUsage(lastCpu);
    lastCpu = process.cpuUsage();
    lastAt = now;
    const ms = (ns: number) => Math.round((ns / 1e6) * 10) / 10;
    const workers: ServerLine["workers"] = {};
    const pids = new Set<number>();
    for (const w of await findWorkers()) {
      pids.add(w.pid);
      const now2 = await readWorker(w.pid);
      if (!now2) continue;
      const before = lastWorker.get(w.pid);
      lastWorker.set(w.pid, now2);
      const entry = (workers[w.plugin] ??= { rssMB: 0, cpuPct: 0 });
      entry.rssMB += Math.round(now2.rssMB * 10) / 10;
      // A worker seen for the first time has no earlier reading, so it shows memory but no CPU yet.
      if (before) entry.cpuPct += Math.round(((now2.cpu - before.cpu) / elapsed) * 1000) / 10;
    }
    for (const pid of lastWorker.keys()) if (!pids.has(pid)) lastWorker.delete(pid);
    const memory = process.memoryUsage();
    const handlers = Object.fromEntries(pending);
    pending.clear();
    const line: ServerLine = {
      v: 1,
      t: Date.now(),
      kind: "server",
      eventLoop: { p50: ms(loop.percentile(50)), p99: ms(loop.percentile(99)), max: ms(loop.max) },
      cpuPct: Math.round((((cpu.user + cpu.system) / 1e6 / elapsed) * 100) * 10) / 10,
      rssMB: Math.round(memory.rss / 1048576),
      heapMB: Math.round(memory.heapUsed / 1048576),
      workers,
      handlers,
    };
    loop.reset();
    latestServer = line;
    await write([line]);
  };

  bb.background.service("sampler", {
    async start(signal) {
      let tick = 0;
      while (!signal.aborted) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, tick === 0 ? 5_000 : SAMPLE_MS);
          signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
        });
        if (signal.aborted) break;
        tick++;
        // Once a day's worth of ticks, drop files past the retention.
        if (tick % 60 === 1) await writer.prune(Date.now()).catch(() => []);
        await sample().catch((error) => bb.log.warn(`server sample failed: ${error instanceof Error ? error.message : String(error)}`));
      }
      loop.disable();
    },
  });

  // --- the CLI, for the analyst bot and for you ------------------------------------------

  bb.cli.register(
    defineCli({
      name: "performance",
      summary: "How far BB is from feeling native, measured while you use it",
      commands: {
        summary: cliCommand({
          summary: "Targets, measured values and the worst gap over the recent lines the server holds (about the last hour)",
          options: { json: { type: "boolean", description: "Emit machine-readable JSON" } },
          async run(input) {
            const windows = recentLines.filter((l): l is WindowLine => l.kind === "window");
            const merged = mergeWindows(windows);
            const navs = {
              switches: recentLines.flatMap((l) => (l.kind === "nav" && l.what === "thread-switch" ? [l.ms] : [])),
              panels: recentLines.flatMap((l) => (l.kind === "nav" && l.what === "panel-open" ? [l.ms] : [])),
            };
            const startLine = [...recentLines].reverse().find((l) => l.kind === "start");
            const rows = measures(merged, navs, { settled: startLine?.kind === "start" ? startLine.settled : null }, null);
            const gap = worstGap(rows);
            const out = { windows: windows.length, dir, measures: rows, worst: gap?.id ?? null, server: latestServer };
            if (input.options.json) return { exitCode: 0, stdout: JSON.stringify(out, null, 2) };
            const text = rows
              .map((r) => `${r.label}: ${r.value == null ? "no data" : `${Math.round(r.value * 10) / 10} ${r.unit}`} (target ${r.target} ${r.unit}, ${r.tone})`)
              .join("\n");
            return { exitCode: 0, stdout: `${text}\nFiles: ${dir}` };
          },
        }),
        files: cliCommand({
          summary: "Where the metrics files are",
          options: { json: { type: "boolean", description: "Emit machine-readable JSON" } },
          async run(input) {
            return { exitCode: 0, stdout: input.options.json ? JSON.stringify({ dir }) : dir };
          },
        }),
      },
    }),
  );

  bb.log.info(`loaded, pid ${process.pid}, metrics in ${dir}`);
  bb.onDispose(() => {
    loop.disable();
    bb.log.info("disposed");
  });
}
