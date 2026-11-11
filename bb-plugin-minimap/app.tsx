// bb-plugin-minimap — frontend entry.
//
// An app overlay (React, knows the route's threadId) that mounts one strip per thread
// beside its timeline's scroller. React and @get-bb/plugin-sdk/app are provided by BB
// at load time, never bundled.
import { useEffect, useMemo, useState } from "react";
import { definePluginApp, useBbContext } from "@get-bb/plugin-sdk/app";
import { Minimap } from "./src/Minimap";
import { Panel, SettingsPage } from "./src/Panel";
import { stripOptions, useOptions } from "./src/options";
import { threadMenu } from "./src/ThreadMenu";
import "./src/styles.css";

/** The longest a thread waits for an idle moment before its strip is mounted anyway. */
const IDLE_WAIT_MS = 1500;
/** Where there is no idle callback (Safari), how long after the thread's paint the strip waits instead. */
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
 * The thread whose strip may mount: `threadId` once the page has drawn it and gone
 * idle, `null` until then. Opening a thread is BB's busiest moment, and the strip is
 * not needed to read it, so its own fetch and setup wait their turn.
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

function Overlay() {
  const { threadId } = useBbContext();
  const options = useOptions();
  const { ready, enabled, loadHistory } = options;
  const settled = useSettled(threadId);
  // One object per change, so the strip is told when an option moved and not on every render.
  const next = stripOptions(options);
  const key = JSON.stringify(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const strip = useMemo(() => next, [key]);
  // Not before the saved settings are known: a strip switched off would otherwise flash on every thread.
  const live = settled !== null && ready && enabled;
  return (
    <>
      {live ? <Minimap key={settled} threadId={settled} options={strip} loadHistory={loadHistory} /> : null}
      <Panel />
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "minimap", component: Overlay });
  app.slots.experimental_threadAction(threadMenu);
  app.slots.settingsSection({ id: "minimap", title: "Minimap", description: "The strip that stands in for the scrollbar.", component: SettingsPage });
});
