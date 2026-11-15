/**
 * The settings, named once for the server, the page and the thread menu. Import-free on purpose:
 * the page bundle reads these values, and importing a value from `server.ts` would pull the
 * server's SDK and zod into it.
 */

/** Which halves of the bar are drawn. */
export const HALVES = ["both", "message", "reply"] as const;
export type Halves = (typeof HALVES)[number];

/** The boolean settings the thread menu switches. */
export const SETTING_KEYS = ["enabled", "showStatus", "showPosition", "showFullText", "debugLog", "showPinButton"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/** What each setting is until the saved settings say otherwise. */
export const DEFAULTS: Record<SettingKey, boolean> = {
  enabled: true,
  showStatus: true,
  showPosition: true,
  showFullText: true,
  debugLog: false,
  showPinButton: true,
};
export const DEFAULT_HALVES: Halves = "both";
