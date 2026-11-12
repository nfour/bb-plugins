// bb-plugin-pinned-turns — frontend entry.
//
// An app overlay (React, knows the route's threadId) that portals the bar into
// the thread scroller. React and @get-bb/plugin-sdk/app are provided by BB at
// load time, never bundled.
import { useEffect, useState } from "react";
import { definePluginApp, useBbContext } from "@get-bb/plugin-sdk/app";
import { useOptions } from "./src/options";
import { PinnedTurns } from "./src/PinnedTurns";
import { threadMenu } from "./src/ThreadMenu";
import "./src/styles.css";

/** The longest a thread waits for an idle moment before its bar is mounted anyway. */
const IDLE_WAIT_MS = 1500;
/** Where there is no idle callback (Safari), how long after the thread's paint the bar waits instead. */
const NO_IDLE_WAIT_MS = 200;

/** Run `callback` once the page is idle, or after `IDLE_WAIT_MS` at the latest; returns a canceller. */
function whenIdle(callback: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(callback, { timeout: IDLE_WAIT_MS });
    return () => cancelIdleCallback(id);
  }
  const id = window.setTimeout(callback, NO_IDLE_WAIT_MS);
  return () => window.clearTimeout(id);
}

/**
 * The thread whose bar may mount: `threadId` once the page has drawn it and gone
 * idle, `null` until then. Opening a thread is BB's busiest moment (its timeline
 * fetch, mounting and measuring the rows), and the bar is not needed to read it,
 * so its own fetch and setup wait their turn.
 */
function useSettled(threadId: string | null): string | null {
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    if (threadId === null) return;
    let idle = () => {};
    // Two frames: the first runs before the new thread's paint, the second after it.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        frame = 0;
        idle = whenIdle(() => setSettled(threadId));
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      idle();
    };
  }, [threadId]);
  return settled === threadId ? settled : null;
}

/** How often the page is looked at for panes that opened, closed or changed thread; it stops while the tab is in the background. */
const PANE_SCAN_MS = 1000;

/**
 * The threads whose timelines are on the page: one for a single thread, one per pane in a split workspace. BB hands a
 * plugin only the focused one (`useBbContext`), so the rest are read off the page: a timeline's rows carry their
 * thread's id as the start of `data-timeline-row-id`.
 */
function paneThreads(): string[] {
  const ids: string[] = [];
  for (const scroller of document.querySelectorAll("[data-page-scroll-viewport]")) {
    const id = scroller.querySelector("[data-timeline-row-id]")?.getAttribute("data-timeline-row-id");
    const thread = id ? id.slice(0, id.indexOf(":")) : "";
    if (thread && !ids.includes(thread)) ids.push(thread);
  }
  return ids;
}

/**
 * Every thread that may have a bar, once the focused thread has settled (see `useSettled`). A cheap look at the page
 * once a second finds panes that opened, closed or switched thread; it stops while the tab is in the background and looks once on
 * return.
 */
function usePaneThreads(settled: string | null): string[] {
  const [threads, setThreads] = useState<string[]>([]);
  useEffect(() => {
    if (settled === null) return;
    const scan = () => {
      const next = paneThreads();
      setThreads((now) => (now.length === next.length && now.every((id, at) => id === next[at]) ? now : next));
    };
    let timer = 0;
    const sync = () => {
      window.clearInterval(timer);
      timer = 0;
      if (document.hidden) return;
      scan();
      timer = window.setInterval(scan, PANE_SCAN_MS);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [settled]);
  return threads;
}

function Overlay() {
  const { threadId } = useBbContext();
  const { ready, enabled } = useOptions();
  const settled = useSettled(threadId);
  const threads = usePaneThreads(settled);
  // Not before the saved settings are known: a bar switched off would otherwise flash on every thread.
  if (settled === null || !ready || !enabled) return null;
  return (
    <>
      {threads.map((id) => (
        <PinnedTurns key={id} threadId={id} />
      ))}
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "pinned-turns", component: Overlay });
  app.slots.experimental_threadAction(threadMenu);
});
