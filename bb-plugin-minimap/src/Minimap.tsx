import { useEffect, useRef } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { createStrip, type Options as StripOptions, type Strip } from "./strip";
import { inBackground } from "./tab";
import { watchTimeline, type Watch } from "./timeline";

/**
 * One thread's minimap. It renders nothing: the strip is a node the controller puts
 * beside the thread's scroller and draws itself, so a streaming reply, a scroll or a
 * drag never re-renders React.
 */
export function Minimap({ threadId, options, loadHistory }: { threadId: string; options: StripOptions; loadHistory: boolean }) {
  const sdk = useSdk();
  const strip = useRef<Strip | null>(null);
  // The option is applied to the live strip; it does not rebuild it or refetch the thread.
  const latest = useRef(options);
  latest.current = options;
  const watch = useRef<Watch | null>(null);
  const wanted = useRef(loadHistory);
  wanted.current = loadHistory;

  useEffect(() => {
    const created = createStrip(threadId, latest.current);
    strip.current = created;
    created.onNeed((need) => watch.current?.setNeed(need));
    // Nothing is read while the strip is not on screen (a narrow window) or the tab is in the background.
    let shown = false;
    const watcher = watchTimeline(sdk, threadId, (rows) => created.setRows(rows), wanted.current);
    watch.current = watcher;
    const sync = () => watcher.setActive(shown && !inBackground());
    created.onShown((now) => {
      shown = now;
      sync();
    });
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      watcher.stop();
      watch.current = null;
      created.dispose();
      strip.current = null;
    };
  }, [sdk, threadId]);

  useEffect(() => {
    strip.current?.setOptions(options);
  }, [options]);

  useEffect(() => {
    watch.current?.setHistory(loadHistory);
  }, [loadHistory]);

  return null;
}
