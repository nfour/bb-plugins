// The docking rules that need no DOM: which tile is the panel's bottom one, whether a panel is shut, which pane a
// panel id names. No imports, so the tests run them as they are.

/** The id prefix of a split workspace's right panel: `thread-detail-secondary-panel-<pane id>`. */
export const PANEL_PREFIX = "thread-detail-secondary-panel-";

/** The pane a panel id names, or null for the plain `thread-detail-secondary-panel` (and for any other id). */
export function paneOfPanelId(id: string): string | null {
  return id.startsWith(PANEL_PREFIX) && id.length > PANEL_PREFIX.length ? id.slice(PANEL_PREFIX.length) : null;
}

/**
 * Which of a split panel's tiles is the bottom one: the lowest, then the leftmost among those within a pixel of it
 * (tile order in the DOM is creation order, not screen order). -1 for none.
 */
export function lowestIndex(tiles: readonly { bottom: number; left: number }[]): number {
  if (tiles.length < 2) return tiles.length - 1;
  let best = -1;
  let bottom = -Infinity;
  let left = Infinity;
  tiles.forEach((tile, index) => {
    const lower = tile.bottom > bottom + 1;
    if (lower || (tile.bottom > bottom - 1 && tile.left < left)) {
      best = index;
      bottom = lower ? tile.bottom : Math.max(bottom, tile.bottom);
      left = tile.left;
    }
  });
  return best;
}

/**
 * Whether the right panel is collapsed: BB sizes the split panel to 0 (`data-panel-size`), makes the drawer inert
 * while closed, and hides the aside from assistive technology.
 */
export function isShut({ size, inert, ariaHidden }: { size: string | undefined; inert: boolean; ariaHidden: string | null }): boolean {
  const n = Number.parseFloat(size ?? "");
  return inert || ariaHidden === "true" || (Number.isFinite(n) && n <= 0);
}

/** Where a pane's composer shell belongs: its chat column, the strip under the panel's tab, or the Chat tab's body. */
export type Want = "column" | "strip" | "tab";

/**
 * What to do about one pane, from where its shell belongs (`want`), where it is held now (`held`, null in the column),
 * whether the column offers a shell (`columnShell`) and whether the held place still has one (`holds`):
 * - `none`: nothing is held and nothing to hold.
 * - `hold`: take the column's shell into `want`'s place.
 * - `release`: put the held shell back in the column (it belongs there, or it is gone from where it was held).
 * - `replace`: the column offers a shell while one is held, so the held one is stale (the thread changed under the
 *   panel): drop it and hold the new one.
 * - `move`: the shell belongs in the other docking place now (the lock switched): move it there once, never through the column.
 * - `keep`: it is where it belongs.
 */
export type Step = "none" | "hold" | "release" | "replace" | "move" | "keep";

export function plan({ want, held, columnShell, holds }: { want: Want; held: Want | null; columnShell: boolean; holds: boolean }): Step {
  if (want === "column") return held ? "release" : "none";
  if (!held) return columnShell ? "hold" : "none";
  if (columnShell) return "replace";
  if (!holds) return "release";
  return held === want ? "keep" : "move";
}
