/**
 * The toolbar button's glyph: lucide's folder-tree (ISC licence,
 * https://lucide.dev/icons/folder-tree). BB's icon set has no tree, so the
 * plugin registers it under its own name; `experimental_Icon` resolves a
 * registration before the built-ins.
 */
export const TREE_ICON = "diff-plus/tree";
/** The view switch's glyphs: lucide's list and list-tree (ISC licence). */
export const LIST_ICON = "diff-plus/list";
export const LIST_TREE_ICON = "diff-plus/list-tree";

const Glyph = ({ className, paths }: { className?: string; paths: string[] }) => (
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
    {paths.map((d) => (
      <path key={d} d={d} />
    ))}
  </svg>
);

export const ListIcon = ({ className }: { className?: string }) => (
  <Glyph className={className} paths={["M3 5h.01", "M3 12h.01", "M3 19h.01", "M8 5h13", "M8 12h13", "M8 19h13"]} />
);

export const ListTreeIcon = ({ className }: { className?: string }) => (
  <Glyph className={className} paths={["M8 5h13", "M13 12h8", "M13 19h8", "M3 10a2 2 0 0 0 2 2h3", "M3 5v12a2 2 0 0 0 2 2h3"]} />
);

export function TreeIcon({ className }: { className?: string }) {
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
      <path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" />
      <path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" />
      <path d="M3 5a2 2 0 0 0 2 2h3" />
      <path d="M3 3v13a2 2 0 0 0 2 2h3" />
    </svg>
  );
}
