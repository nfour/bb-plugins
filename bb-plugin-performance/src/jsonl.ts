// bb-plugin-performance — the metrics files: one JSONL file per day, appended to
// in batches, old days deleted, and a size cap so a bad day cannot fill a disk.
import { appendFile, mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

export const KEEP_DAYS = 14;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** `YYYY-MM-DD` in local time, the name of a day's file. */
export function dayOf(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

/** Which of `names` are metrics files older than `keep` days before `now`, oldest first. */
export function expired(names: string[], now: number, keep = KEEP_DAYS): string[] {
  const cutoff = dayOf(now - keep * 86_400_000);
  return names.filter((name) => FILE.test(name) && name.slice(0, 10) < cutoff).sort();
}

export interface Writer {
  /** Appends lines (already objects with a `t`), grouped into the file of each one's day. Returns how many were written. */
  append(lines: { t: number }[], header: () => { t: number }): Promise<number>;
  /** The newest `limit` lines of today's file (for the dashboard after a restart). */
  recent(limit: number, now: number): Promise<unknown[]>;
  prune(now: number): Promise<string[]>;
}

export function createWriter(dir: string): Writer {
  const started = new Set<string>();
  return {
    async append(lines, header) {
      if (lines.length === 0) return 0;
      await mkdir(dir, { recursive: true });
      const byDay = new Map<string, { t: number }[]>();
      for (const line of lines) {
        const day = dayOf(line.t);
        byDay.set(day, [...(byDay.get(day) ?? []), line]);
      }
      let written = 0;
      for (const [day, group] of byDay) {
        const file = join(dir, `${day}.jsonl`);
        let size = 0;
        try {
          size = (await stat(file)).size;
        } catch {
          size = 0;
        }
        if (size >= MAX_FILE_BYTES) continue;
        // The first write of a file (this run or a new day) opens it with the targets, so a reader can compare.
        const fresh = size === 0 || !started.has(file);
        started.add(file);
        const out = (fresh && size === 0 ? [header(), ...group] : group).map((l) => JSON.stringify(l)).join("\n") + "\n";
        await appendFile(file, out);
        written += group.length;
      }
      return written;
    },
    async recent(limit, now) {
      try {
        const text = await readFile(join(dir, `${dayOf(now)}.jsonl`), "utf8");
        const rows = text.split("\n").filter(Boolean).slice(-limit);
        const parsed: unknown[] = [];
        for (const row of rows) {
          try {
            parsed.push(JSON.parse(row));
          } catch {
            // a half-written line at the end is skipped
          }
        }
        return parsed;
      } catch {
        return [];
      }
    },
    async prune(now) {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return [];
      }
      const old = expired(names, now);
      for (const name of old) await unlink(join(dir, name)).catch(() => {});
      return old;
    },
  };
}
