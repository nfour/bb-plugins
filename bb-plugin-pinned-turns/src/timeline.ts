import { useCallback, useEffect, useRef, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { indexOf, outlineOf, type Outline, type TimelineIndex } from "./rows";
import { watchTimeline, type Debug, type Watch } from "./watch";

export type { Debug, Outline, TimelineIndex };

const EMPTY: TimelineIndex = { rank: new Map(), messages: [], hasOlder: false };

/** Where a failed tally read waits before being tried again. */
const RETRY_MS = 3000;

/**
 * The thread's timeline as an index, kept current by `watchTimeline` (`src/watch.ts`). `active` is
 * whether the bar is shown and the tab in view: while it is not, nothing is read.
 */
export function useTimeline(threadId: string, debug: Debug, active: boolean) {
  const sdk = useSdk();
  const log = useRef(debug);
  log.current = debug;
  const wanted = useRef(active);
  wanted.current = active;
  const [index, setIndex] = useState<TimelineIndex>(EMPTY);
  const watch = useRef<Watch | null>(null);

  useEffect(() => {
    setIndex(EMPTY);
    const mine = watchTimeline(
      sdk,
      threadId,
      (rows, hasOlder) => setIndex(indexOf(rows, hasOlder)),
      (event, data) => log.current(event, data),
      wanted.current,
    );
    watch.current = mine;
    return () => {
      mine.stop();
      watch.current = null;
    };
  }, [sdk, threadId]);

  useEffect(() => watch.current?.setActive(active), [active]);

  const loadOlder = useCallback(() => watch.current?.loadOlder(), []);
  return { index, loadOlder };
}

/**
 * The thread's user messages in order, for the turn counter. BB's
 * `conversationOutline` lists every one of them by the timeline's row id in one small response
 * (a few KB, against ~100KB a timeline page), so the counter does not need the
 * older pages fetched. It is fetched again when the newest user message changes,
 * which is the only time the count can. `active` is whether the bar is shown and
 * the tab in view: while it is not nothing is read (the tally held stays), and
 * becoming active reads once if the newest message changed meanwhile.
 */
export function useOutline(threadId: string, enabled: boolean, active: boolean, newestUser: string | undefined): Outline | null {
  const sdk = useSdk();
  const [tally, setTally] = useState<Outline | null>(null);
  // What the tally held was read for, so becoming active again does not read it twice.
  const readFor = useRef<string | null>(null);
  useEffect(() => {
    // Not before the timeline's first page: the tally is fetched once it can be read against it.
    if (!enabled || !active || newestUser === undefined) return;
    const key = `${threadId}|${newestUser}`;
    if (readFor.current === key) return;
    const controller = new AbortController();
    let timer = 0;
    const load = async () => {
      try {
        const { items } = await sdk.threads.conversationOutline({ threadId, role: "user", signal: controller.signal });
        if (controller.signal.aborted) return;
        readFor.current = key;
        setTally(outlineOf(items));
      } catch {
        if (!controller.signal.aborted) timer = window.setTimeout(load, RETRY_MS);
      }
    };
    load();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [sdk, threadId, enabled, active, newestUser]);
  return enabled ? tally : null;
}
