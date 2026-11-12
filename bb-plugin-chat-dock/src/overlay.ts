/**
 * The phone drawer's dock. BB portals the drawer to `body`, outside its React
 * root, and React ignores every event whose target is outside the root it
 * rendered into: a shell moved into the drawer takes typing (the editor listens
 * natively) but none of its buttons, and never expands on a tap, so its footer
 * never shows. In the drawer the shell stays inside the root instead, in a frame
 * laid over the host's place at the drawer's bottom; the host keeps the frame's
 * height, so nothing in the drawer is covered and the tab body shrinks as it
 * does on the desktop.
 *
 * The layer copies the drawer's box (and its z-index plus one) whenever the
 * drawer resizes: opening (BB 0.49 grows its width; it does not slide), a
 * rotation, and the on-screen keyboard, which BB answers by shrinking the
 * drawer to the visual viewport (`--bb-shell-height` on `body`). A
 * `ResizeObserver` is delivered after layout and before paint, so the frame
 * moves in the same frame as the drawer. Nothing runs on a scroll, a tap or a drag.
 */

export interface Overlay {
  /** Where the shell goes: a child of BB's React root, laid over the host. */
  frame: HTMLElement;
  /** False once BB has replaced the drawer the overlay lies over. */
  live(): boolean;
  dispose(): void;
}

const overlays = new WeakMap<HTMLElement, Overlay>();
let count = 0;

/** The overlay standing in for `host`, if the host is a drawer's. */
export function overlayOf(host: HTMLElement): Overlay | undefined {
  return overlays.get(host);
}

/** Lays a frame over `host` (in `drawer`) for the shell to go into. */
export function createOverlay(host: HTMLElement, drawer: HTMLElement): Overlay {
  // A layer the drawer's size that lets touches through, and the frame at its bottom that holds the shell.
  const layer = document.createElement("div");
  layer.className = "chat-dock-overlay";
  // Set here: the word is a utility to the build, which would scope a rule for it page-wide.
  layer.style.position = ["fix", "ed"].join("");
  const frame = document.createElement("div");
  frame.dataset.chatDockHost = "overlay";
  // The host's own look (its padding, the strip's top rule), so the frame is drawn as the host would be.
  frame.className = `${host.className} chat-dock-overlay-frame`;
  layer.appendChild(frame);
  // Appended after React's own children of the root; React only moves and removes nodes it made.
  (document.getElementById("root") ?? document.body).appendChild(layer);
  host.dataset.chatDockSpacer = "";
  // The drawer is a modal dialog, so assistive technology may skip what is outside
  // it; owning the frame from the host keeps the composer inside it for them.
  frame.id = `chat-dock-overlay-${++count}`;
  host.setAttribute("aria-owns", frame.id);

  // The drawer's box less its edges and padding: where its content, and so the host, sits.
  const place = () => {
    if (!drawer.isConnected) return;
    const box = drawer.getBoundingClientRect();
    const style = getComputedStyle(drawer);
    const px = (value: string) => Number.parseFloat(value) || 0;
    const left = px(style.borderLeftWidth) + px(style.paddingLeft);
    const right = px(style.borderRightWidth) + px(style.paddingRight);
    const bottom = px(style.borderBottomWidth) + px(style.paddingBottom);
    layer.style.left = `${box.left + left}px`;
    layer.style.top = `${box.top}px`;
    layer.style.width = `${Math.max(0, box.width - left - right)}px`;
    layer.style.height = `${Math.max(0, box.height - bottom)}px`;
    layer.style.zIndex = String((Number.parseInt(style.zIndex, 10) || 45) + 1);
  };
  const sized = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === frame) host.style.height = `${entry.borderBoxSize[0]?.blockSize ?? frame.getBoundingClientRect().height}px`;
      else place();
    }
  });
  sized.observe(drawer);
  sized.observe(frame);
  // Should a later BB slide the drawer rather than size it, the layer catches up when the slide ends.
  const settled = (event: TransitionEvent) => {
    if (event.target === drawer) place();
  };
  drawer.addEventListener("transitionend", settled);
  place();

  const overlay: Overlay = {
    frame,
    live: () => drawer.isConnected && layer.isConnected,
    dispose() {
      overlays.delete(host);
      sized.disconnect();
      drawer.removeEventListener("transitionend", settled);
      layer.remove();
      delete host.dataset.chatDockSpacer;
      host.removeAttribute("aria-owns");
      host.style.height = "";
    },
  };
  overlays.set(host, overlay);
  return overlay;
}
