import { useEffect } from "react";
import { useBbContext } from "@get-bb/plugin-sdk/app";
import { useDebug } from "./debug";
import { configure, setLog } from "./reconcile";
import { useOptions } from "./options";

/**
 * Renders nothing: tells the reconciler (`reconcile.ts`) whether a thread is showing,
 * what the options are and where the debug log is. Nothing renders through React
 * in the docking itself: BB owns every element involved.
 */
export function Docking() {
  const { threadId } = useBbContext();
  const { ready, enabled, locked } = useOptions();
  const log = useDebug();
  const thread = threadId !== null;

  useEffect(() => setLog((event, data) => log.current(event, data)), [log]);
  useEffect(() => {
    configure({ thread, ready, enabled, locked });
  }, [thread, ready, enabled, locked]);
  useEffect(() => () => configure({ thread: false }), []);
  return null;
}
