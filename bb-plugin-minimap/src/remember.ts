import type { Measure } from "./model.ts";

/** What a strip learned about a thread's row sizes, kept for when its tab is opened again. */
export interface Memory {
  columnWidth: number;
  cache: Map<string, Measure>;
}

/** The most threads kept: each holds a size per row it has seen. */
export const MAX_THREADS = 6;

const kept = new Map<string, Memory>();

/** Keep `memory` for `threadId`, the least recently kept thread making room. An empty one is not worth keeping. */
export function remember(threadId: string, memory: Memory): void {
  kept.delete(threadId);
  if (memory.cache.size === 0) return;
  kept.set(threadId, { columnWidth: memory.columnWidth, cache: new Map(memory.cache) });
  while (kept.size > MAX_THREADS) kept.delete(kept.keys().next().value!);
}

/** What was kept for `threadId`, or undefined. It stays kept until the strip that took it stores again. */
export function recall(threadId: string): Memory | undefined {
  return kept.get(threadId);
}

/** Forget everything (for tests). */
export function forgetAll(): void {
  kept.clear();
}
