// bb-plugin-performance — reading /proc (Linux) for the host-worker processes.
// Plugin back-ends run inside BB's server process, so only a plugin's host
// entry (bb.host) has a process of its own; those are the ones `ps` can name.
import { readdir, readFile } from "node:fs/promises";

const CLK_TCK = 100;

/** The plugin a worker process runs, from its argv: `…-worker.mjs <host.mjs> <pluginId> …`; null for any other process. */
export function workerPlugin(argv: string[]): string | null {
  const at = argv.findIndex((a) => /(?:plugin-host|provider-bridge)-worker\.mjs$/.test(a));
  if (at < 0) return null;
  const id = argv[at + 2];
  return id && /^[\w@./-]+$/.test(id) ? id : null;
}

/** Cumulative CPU seconds (user + system) from the text of /proc/<pid>/stat. */
export function cpuSeconds(stat: string): number | null {
  // The command name sits in parentheses and may contain spaces; fields count from after the last ")".
  const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const user = Number(rest[11]);
  const system = Number(rest[12]);
  if (!Number.isFinite(user) || !Number.isFinite(system)) return null;
  return (user + system) / CLK_TCK;
}

/** Resident memory in MB from the text of /proc/<pid>/status. */
export function rssMB(status: string): number | null {
  const kb = /^VmRSS:\s+(\d+)\s*kB/m.exec(status)?.[1];
  return kb == null ? null : Number(kb) / 1024;
}

export interface Worker {
  pid: number;
  plugin: string;
}

/** Every worker process now running, by scanning /proc. Empty where /proc does not exist. */
export async function findWorkers(): Promise<Worker[]> {
  let names: string[];
  try {
    names = await readdir("/proc");
  } catch {
    return [];
  }
  const found: Worker[] = [];
  await Promise.all(
    names
      .filter((n) => /^\d+$/.test(n))
      .map(async (n) => {
        try {
          const argv = (await readFile(`/proc/${n}/cmdline`, "utf8")).split("\0");
          const plugin = workerPlugin(argv);
          if (plugin) found.push({ pid: Number(n), plugin });
        } catch {
          // the process ended between the listing and the read
        }
      }),
  );
  return found;
}

export interface Reading {
  cpu: number;
  rssMB: number;
}

export async function readWorker(pid: number): Promise<Reading | null> {
  try {
    const [stat, status] = await Promise.all([readFile(`/proc/${pid}/stat`, "utf8"), readFile(`/proc/${pid}/status`, "utf8")]);
    const cpu = cpuSeconds(stat);
    const rss = rssMB(status);
    return cpu == null || rss == null ? null : { cpu, rssMB: rss };
  } catch {
    return null;
  }
}
