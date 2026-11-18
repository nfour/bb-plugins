import { atEnd } from "./model.ts";

/**
 * Keeps a scrolling box at its end while its text grows, until the reader scrolls up in it; scrolling back to
 * the end hands it back. Returns what stops it. Only this box is watched, and only while it is attached.
 */
export function follow(box: HTMLElement): () => void {
  // A box starts followed: while it is closed it has no height, so it cannot be judged by its scroll position.
  let stuck = true;
  let frame = 0;
  let top = 0;
  const toEnd = () => {
    frame = 0;
    box.scrollTop = box.scrollHeight;
    top = box.scrollTop;
  };
  // A scroll event arrives after the text has grown again, so the position alone would read as "not at the end".
  // Only a move up is the reader leaving; reaching the end again is the reader coming back.
  const onScroll = () => {
    const now = box.scrollTop;
    if (now < top - 1) stuck = false;
    else if (atEnd(box)) stuck = true;
    top = now;
  };
  const observer = new MutationObserver(() => {
    if (stuck && !frame) frame = requestAnimationFrame(toEnd);
  });
  box.addEventListener("scroll", onScroll, { passive: true });
  observer.observe(box, { childList: true, subtree: true, characterData: true });
  if (stuck) toEnd();
  return () => {
    cancelAnimationFrame(frame);
    box.removeEventListener("scroll", onScroll);
    observer.disconnect();
  };
}
