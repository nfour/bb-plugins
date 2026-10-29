/**
 * The dock button's glyph. BB's icon set has no dock, so the plugin registers
 * lucide's (ISC licence, https://lucide.dev/icons/dock) under its own name;
 * `experimental_Icon` resolves a registration before the built-ins.
 */
export const DOCK_ICON = "chat-dock/dock";

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
      <path d="M2 8h20" />
      <rect width="20" height="8" x="2" y="14" rx="2" />
      <path d="M6 18h2" />
      <path d="M12 18h6" />
    </svg>
  );
}

/**
 * The Return row's glyph: a window with a bottom band and an arrow down into it,
 * the composer going back under the timeline. Deliberately not a send (⏎) or a
 * panel toggle.
 */
export function ReturnIcon({ className }: { className?: string }) {
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
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 15h18" />
      <path d="M17 7.5 11.5 12" />
      <path d="M11 8.5V12h3.5" />
    </svg>
  );
}
