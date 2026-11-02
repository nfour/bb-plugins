import { useEffect, useState } from "react";
import { useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { compile, type Matcher } from "./lexicon.ts";
import { useOptions } from "./options";
import { onThreads, setEnabled, setLexicon } from "./paint.ts";

/** How often an open thread's lexicon is asked for again; the answer is `unchanged` unless something moved. */
const POLL_MS = 4000;

/** The lexicon last read for each environment, so a thread seen again paints at once. Never shared between environments. */
const cache = new Map<string, { revision: string; matcher: Matcher | null }>();
const CACHE_MAX = 12;
const remember = (environmentId: string, revision: string, matcher: Matcher | null) => {
  cache.delete(environmentId);
  cache.set(environmentId, { revision, matcher });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
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
  const { enabled, symbols } = useOptions();
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const threads = useThreads();
  const key = threads.join(" ");

  useEffect(() => {
    setEnabled(enabled);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const stops = threads.map((threadId) => {
      let disposed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
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
        if (held) setLexicon(threadId, held.matcher);
        const read = async () => {
          if (!document.hidden) {
            try {
              const answer = await rpc.call("lexicon", known === undefined ? { environmentId, symbols } : { environmentId, known, symbols });
              if (disposed) return;
              if (!answer.unchanged) {
                known = answer.revision;
                const matcher = answer.entries.length ? compile(answer.entries) : null;
                remember(environmentId, answer.revision, matcher);
                setLexicon(threadId, matcher);
              }
            } catch {
              // The next poll tries again.
            }
          }
          if (!disposed) timer = setTimeout(read, POLL_MS);
        };
        void read();
      };
      void run();
      return () => {
        disposed = true;
        controller.abort();
        clearTimeout(timer);
        setLexicon(threadId, null);
      };
    });
    return () => stops.forEach((stop) => stop());
    // `key` stands for `threads`: a new array with the same threads must not restart the polls.
  }, [rpc, sdk, enabled, symbols, key]);

  return null;
}
