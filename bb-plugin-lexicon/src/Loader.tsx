import { tabAway } from "./tab.ts";
import { useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { compile, type Entry, type Kind, type Matcher } from "./lexicon.ts";
import { kindsOn, useOptions } from "./options";
import { CHANGED, concerns, readChanged, type Changed } from "./signal.ts";
import { onThreads, setEnabled, setLexicon, setPrompts } from "./paint.ts";

/**
 * A lexicon is read when a pane's thread appears and again when the backend
 * signals that the project's terms moved (an edit from any window, an agent's
 * change, a rescan that found other names) or the connection came back. This
 * slow read is only a safety net, and what starts the backend's next rescan of
 * the source; the answer is `unchanged` unless something moved.
 */
const SAFETY_MS = 60_000;

/** What each open pane does when a signal concerns its project. */
const panes = new Set<(signal: Changed | null) => void>();

/** The lexicon last read for each environment, so a thread seen again paints at once. Never shared between environments. The entries are kept, not the matcher, so a change of kinds needs no read. */
const cache = new Map<string, { revision: string; entries: Entry[] }>();
const CACHE_MAX = 12;
const remember = (environmentId: string, revision: string, entries: Entry[]) => {
  cache.delete(environmentId);
  cache.set(environmentId, { revision, entries });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
};

/** The matcher for the entries of the kinds that are on, or none when nothing is left to paint. */
const matcherOf = (entries: readonly Entry[], kinds: ReadonlySet<Kind>): Matcher | null => {
  const wanted = entries.filter((entry) => kinds.has(entry.kind));
  return wanted.length ? compile(wanted) : null;
};

/** The threads that have a timeline on the page: one per open pane. */
function useThreads(): readonly string[] {
  const [threads, setThreads] = useState<readonly string[]>([]);
  useEffect(() => onThreads(setThreads), []);
  return threads;
}

/**
 * Renders nothing. A content script has no React, so this overlay, mounted on
 * every page, reads the settings and each open thread's lexicon and hands them
 * to the painter (src/paint.ts) through module functions; both are in one
 * bundle. Each pane's thread has its own lexicon, from its own environment, and
 * a thread whose lexicon is not known yet is left unpainted. Until the saved
 * settings arrive the plugin is on, its default.
 */
export function Loader() {
  const options = useOptions();
  const { enabled, symbols, paintPrompts } = options;
  const kindsKey = kindsOn(options).join(",");
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const threads = useThreads();
  const key = threads.join(" ");

  useRealtime(CHANGED, (payload) => {
    const signal = readChanged(payload);
    if (signal) for (const nudge of panes) nudge(signal);
  });

  // Signals are ephemeral: what changed while the connection was down is read again once it is back.
  const connection = useRealtimeConnectionState();
  const wasUp = useRef(connection === "connected");
  useEffect(() => {
    if (connection === "connected" && !wasUp.current) for (const nudge of panes) nudge(null);
    wasUp.current = connection === "connected";
  }, [connection]);

  useEffect(() => {
    setEnabled(enabled);
  }, [enabled]);

  useEffect(() => {
    setPrompts(paintPrompts);
  }, [paintPrompts]);

  useEffect(() => {
    if (!enabled) return;
    const kinds = new Set(kindsKey.split(",").filter(Boolean) as Kind[]);
    const stops = threads.map((threadId) => {
      let disposed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let stopWake = () => {};
      const controller = new AbortController();
      const run = async () => {
        let environmentId: string | null;
        try {
          environmentId = (await sdk.threads.get({ threadId, signal: controller.signal })).environmentId ?? null;
        } catch {
          return;
        }
        if (disposed || !environmentId) return;
        const held = cache.get(environmentId);
        let known: string | undefined = held?.revision;
        let projectId: string | null = null;
        if (held) setLexicon(threadId, matcherOf(held.entries, kinds));
        // Nothing is read while the tab is in the background; coming back reads once.
        let sleeping = false;
        let reading = false;
        let again = false;
        const read = async () => {
          if (disposed) return;
          clearTimeout(timer);
          sleeping = tabAway();
          if (sleeping) return;
          // A signal during a read asks for one more read after it, so none is lost.
          if (reading) {
            again = true;
            return;
          }
          reading = true;
          try {
            const answer = await rpc.call("lexicon", known === undefined ? { environmentId, symbols } : { environmentId, known, symbols });
            if (disposed) return;
            projectId = answer.projectId;
            if (!answer.unchanged) {
              known = answer.revision;
              remember(environmentId, answer.revision, answer.entries);
              setLexicon(threadId, matcherOf(answer.entries, kinds));
            }
          } catch {
            // The next signal or safety read tries again.
          }
          reading = false;
          if (again) {
            again = false;
            void read();
          } else if (!disposed) timer = setTimeout(read, SAFETY_MS);
        };
        const nudge = (signal: Changed | null) => {
          if (signal === null || projectId === null || concerns(signal, projectId)) void read();
        };
        panes.add(nudge);
        const wake = () => {
          if (!tabAway() && sleeping) void read();
        };
        document.addEventListener("visibilitychange", wake);
        stopWake = () => {
          document.removeEventListener("visibilitychange", wake);
          panes.delete(nudge);
        };
        void read();
      };
      void run();
      return () => {
        stopWake();
        disposed = true;
        controller.abort();
        clearTimeout(timer);
        setLexicon(threadId, null);
      };
    });
    return () => stops.forEach((stop) => stop());
    // `key` stands for `threads`: a new array with the same threads must not restart the polls.
  }, [rpc, sdk, enabled, symbols, kindsKey, key]);

  return null;
}
