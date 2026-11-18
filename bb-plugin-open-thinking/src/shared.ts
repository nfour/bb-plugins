/**
 * The settings, named once for the server, the page and the thread menu. Import-free on purpose:
 * the page bundle reads these values, and importing a value from `server.ts` would pull the
 * server's SDK and zod into it.
 */

/** The boolean settings; the menu and the settings page switch these. */
export const SETTING_KEYS = ["autoExpand", "closeOnNew", "closeOnFinish", "keepLatest", "followGrowth"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/** What each setting is until the saved settings say otherwise. */
export const DEFAULTS: Record<SettingKey, boolean> = {
  autoExpand: true,
  closeOnNew: false,
  closeOnFinish: false,
  keepLatest: true,
  followGrowth: true,
};

/** The labels BB's settings page and the thread menu show. */
export const LABELS: Record<SettingKey, string> = {
  autoExpand: "Open thinking blocks",
  closeOnNew: "Close earlier thinking blocks when a new one arrives",
  closeOnFinish: "Close thinking blocks when the turn finishes",
  keepLatest: "Keep the latest thinking in view while the turn works",
  followGrowth: "Scroll growing thinking to its end",
};
