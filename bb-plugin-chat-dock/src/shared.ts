// What the page and the backend both read. No imports here: the page bundle must not pull in the backend's libraries.

/**
 * `label` and `description` are what the settings API and the `bb` CLI show. The thread menu says `short` when there is
 * one (its label is shorter there), and the label otherwise.
 */
type BoolDef = { type: "boolean"; label: string; short?: string; description: string; default: boolean };

/**
 * Every setting, once, in the thread menu's order. The backend defines them from this list, and the keys, the defaults
 * and the menu's labels are read off it, so an option is added here and where it is used, nowhere else.
 */
export const SETTINGS = {
  enabled: {
    type: "boolean",
    label: "Dock the composer in the right panel",
    description: "While the panel is open, the composer and the cards above it move into it: as a strip at the panel's bottom, or as a Chat tab.",
    default: true,
  },
  locked: {
    type: "boolean",
    label: "Keep it at the panel's bottom",
    description: "A strip under whichever tab is open, so the composer never goes away while the panel is open. Off, it is a Chat tab instead.",
    default: true,
  },
  showButton: {
    type: "boolean",
    label: "Show the dock button",
    short: "Dock button in the composer",
    description: "The button in the composer's action row that switches docking on and off.",
    default: true,
  },
  debugLog: {
    type: "boolean",
    label: "Debug log",
    description: "Write dock and undock events to the plugin log (`bb plugin logs chat-dock`).",
    default: false,
  },
} as const satisfies Record<string, BoolDef>;

export type SettingKey = keyof typeof SETTINGS;

/** The keys, as the tuple an RPC enum needs. */
export const SETTING_KEYS = Object.keys(SETTINGS) as [SettingKey, ...SettingKey[]];

/** What a setting is until the saved value arrives. */
export const DEFAULTS = Object.fromEntries(SETTING_KEYS.map((key) => [key, SETTINGS[key].default])) as Record<SettingKey, boolean>;

/** What the thread menu calls a setting. */
export const menuLabel = (key: SettingKey): string => (SETTINGS[key] as BoolDef).short ?? SETTINGS[key].label;

/** The definitions the backend hands BB: the list less what is only the page's. */
export function definitions(): Record<SettingKey, Omit<BoolDef, "short">> {
  return Object.fromEntries(
    SETTING_KEYS.map((key) => {
      const { type, label, description, default: value } = SETTINGS[key];
      return [key, { type, label, description, default: value }];
    }),
  ) as Record<SettingKey, Omit<BoolDef, "short">>;
}
