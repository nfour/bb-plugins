// The small card shown when a painted word is clicked. One element, created on
// the click and removed when it is dismissed; while it is open it listens for
// the click away, Escape and a scroll, and otherwise nothing runs.
import type { Explanation } from "./explain.ts";

/** The window event for a new size, spelled in two parts because the build reads the bare word as a utility class. */
const RESIZE = "re" + "size";
let card: HTMLElement | null = null;
let stop = (): void => {};

/** Takes the card away. */
export function closePopover(): void {
  stop();
  stop = () => {};
  card?.remove();
  card = null;
}

/** Shows `what` under (or, near the bottom, above) `anchor`, the word's rectangle. */
export function showPopover(what: Explanation, anchor: DOMRect): void {
  closePopover();
  const root = document.createElement("div");
  root.className = "lexicon-pop";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", what.title);
  const add = (className: string, text: string) => {
    const part = document.createElement("div");
    part.className = className;
    part.textContent = text;
    root.append(part);
  };
  add("lexicon-pop-title", what.title);
  add("lexicon-pop-kind", what.kind);
  for (const line of what.lines) add("lexicon-pop-line", line);
  document.body.append(root);
  card = root;

  const box = root.getBoundingClientRect();
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8));
  const below = anchor.bottom + 6;
  const top = below + box.height > window.innerHeight - 8 ? Math.max(8, anchor.top - box.height - 6) : below;
  root.style.left = `${left}px`;
  root.style.top = `${top}px`;

  const away = (event: Event) => {
    if (!(event.target instanceof Node) || !root.contains(event.target)) closePopover();
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape") closePopover();
  };
  document.addEventListener("pointerdown", away, true);
  document.addEventListener("keydown", key, true);
  document.addEventListener("scroll", closePopover, { capture: true, once: true });
  window.addEventListener(RESIZE, closePopover, { once: true });
  stop = () => {
    document.removeEventListener("pointerdown", away, true);
    document.removeEventListener("keydown", key, true);
    document.removeEventListener("scroll", closePopover, true);
    window.removeEventListener(RESIZE, closePopover);
  };
}
