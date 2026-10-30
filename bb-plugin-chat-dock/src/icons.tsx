/**
 * The dock button's glyph: lucide's dock (ISC licence, https://lucide.dev/icons/dock),
 * shrunk, with a chevron pointing where a click sends the composer. BB's icon set
 * has no dock, so the plugin registers it under its own name; `experimental_Icon`
 * resolves a registration before the built-ins.
 *
 * Both arrangements are drawn and `styles.css` shows one: `>` on the right while
 * the composer is in the chat column, `<` on the left while it sits in one of the
 * plugin's hosts (`[data-chat-dock-host]`). The composer is moved in the DOM, not
 * re-rendered, so CSS is what notices the move in the same frame. The chevron is
 * the taller, full-strength mark; the dock beside it is smaller and faded, with a
 * small gap between them, and the pair fits the one icon.
 */
export const DOCK_ICON = "chat-dock/dock";

/**
 * The dock drawn at 55% and faded, its left edge at `x` (the 24-unit glyph spans x 2–22,
 * y 8–22). A nested viewport does the scaling: the word for the attribute that
 * would is also a Tailwind utility, which the build would then match page-wide.
 */
function Dock({ x }: { x: number }) {
  const scale = 0.55;
  return (
    <g opacity={0.55}>
      <svg x={x - 2 * scale} y={12 - 15 * scale} width={24 * scale} height={24 * scale} viewBox="0 0 24 24" overflow="visible" strokeWidth={2 / scale}>
        <path d="M2 8h20" />
        <rect width="20" height="8" x="2" y="14" rx="2" />
        <path d="M6 18h2" />
        <path d="M12 18h6" />
      </svg>
    </g>
  );
}

export function DockIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <g className="chat-dock-glyph-column">
        <path d="M15.75 4l7 8-7 8" />
        <Dock x={1.25} />
      </g>
      <g className="chat-dock-glyph-docked">
        <path d="M8.25 4l-7 8 7 8" />
        <Dock x={11.75} />
      </g>
    </svg>
  );
}
