import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { OwnerState, rpcContract } from "../server";

export type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

// The state word is split: the plugin build turns that word standing alone into a page-wide rule.
const SHOWN = "vis" + "ible";
const shown = () => document.visibilityState === SHOWN;

/** The time, refreshed every `everyMs` while the tab is on screen; a tab that is not ticks no timer, and coming back catches up once. */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const sync = () => {
      if (!shown()) return stop();
      setNow(Date.now());
      timer ??= setInterval(() => setNow(Date.now()), everyMs);
    };
    if (shown()) timer = setInterval(() => setNow(Date.now()), everyMs);
    document.addEventListener("visibilitychange", sync);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [everyMs]);
  return now;
}

/** One thread's share, kept fresh by the backend's realtime signal. */
export function useOwnerState(threadId: string | null): { state: OwnerState | null; rpc: Rpc; set(next: OwnerState): void } {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<OwnerState | null>(null);
  const latest = useRef(threadId);
  latest.current = threadId;
  const load = useCallback(() => {
    if (!threadId) return;
    rpc
      .call("state", { threadId })
      .then((next) => latest.current === threadId && setState(next))
      .catch(() => {});
  }, [rpc, threadId]);
  useEffect(() => {
    setState(null);
    load();
  }, [load]);
  useRealtime("state", (payload) => {
    if ((payload as { threadId?: string } | null)?.threadId === threadId) load();
  });
  return { state: state?.threadId === threadId ? state : null, rpc, set: setState };
}

export interface SharedThread {
  threadId: string;
  url: string;
  viewers: number;
  pending: number;
}

/** Every live share, for the thread menu and the header. */
export function useShared(): { shares: Map<string, SharedThread>; rpc: Rpc } {
  const rpc = useRpc<typeof rpcContract>();
  const [shares, setShares] = useState<Map<string, SharedThread>>(() => new Map());
  const load = useCallback(() => {
    rpc
      .call("shared", {})
      .then(({ shares: list }) => setShares(new Map(list.map((s) => [s.threadId, s]))))
      .catch(() => {});
  }, [rpc]);
  useEffect(load, [load]);
  useRealtime("state", load);
  return { shares, rpc };
}
