// What the page and the backend both read. No imports here: the page bundle must not pull in the backend's libraries.

type BoolDef = { type: "boolean"; label: string; description?: string; default: boolean };
type NumDef = { type: "number"; label: string; description?: string; default: number; min: number; max: number };
type StrDef = { type: "string"; label: string; description?: string; default: string };

/**
 * Every setting, once. The backend defines them from this list, and the defaults, the keys, the number
 * ranges and the RPC inputs are read off it, so an option is added here and where it is used, nowhere else.
 * A number is held to `min`..`max` where it is written and where it is read.
 */
export const SETTINGS = {
  enabled: { type: "boolean", label: "Show the minimap", default: true },
  hideScrollbar: {
    type: "boolean",
    label: "Replace the scrollbar",
    description: "Hide the timeline's own scrollbar while the minimap shows, so there is one thing to grab.",
    default: true,
  },
  loadHistory: {
    type: "boolean",
    label: "Load the whole history",
    description:
      "Fetch every older page of a long thread in the background so the minimap covers all of it. Off: only the newest page is read, which costs far less.",
    default: false,
  },
  hideToc: {
    type: "boolean",
    label: "Hide the thread-index button",
    description: "BB's thread-index button beside the scrollbar. Off: it sits just left of the minimap, which keeps the right edge.",
    default: false,
  },
  width: { type: "number", label: "Width (px)", description: "How wide the minimap is, from 6 to 120.", default: 26, min: 6, max: 120 },
  showOutline: {
    type: "boolean",
    label: "Show the viewport slider",
    description: "The slider over the part of the thread on screen. Dragging, clicking and the wheel work without it.",
    default: true,
  },
  fadeIdle: {
    type: "boolean",
    label: "Fade when not hovered",
    description: "Dim the minimap to the idle opacity until the pointer is over it.",
    default: true,
  },
  opacity: {
    type: "number",
    label: "Opacity (%)",
    description: "How opaque the minimap is, from 0 to 100; with fading on, the opacity it returns to under the pointer.",
    default: 66,
    min: 0,
    max: 100,
  },
  idleOpacity: { type: "number", label: "Idle opacity (%)", description: "The opacity while faded, from 0 to 100.", default: 33, min: 0, max: 100 },
  sliderRound: {
    type: "boolean",
    label: "Round the slider's corners",
    description: "The viewport slider's box has round corners; off, square ones.",
    default: true,
  },
  sliderOpacity: {
    type: "number",
    label: "Slider opacity (%)",
    description: "How strong the viewport slider's line is, from 0 to 100.",
    default: 26,
    min: 0,
    max: 100,
  },
  sliderThickness: {
    type: "number",
    label: "Slider thickness (px)",
    description: "How thick the viewport slider's line is, from 1 to 6.",
    default: 2,
    min: 1,
    max: 6,
  },
  sliderColor: {
    type: "string",
    label: "Slider colour",
    description: "The viewport slider's colour as #rrggbb. Empty follows the theme's text colour.",
    default: "",
  },
  showUser: { type: "boolean", label: "Show your messages", description: "Draw a rectangle for each of these rows.", default: true },
  colorUser: { type: "string", label: "Your messages colour", description: "A colour as #rrggbb. Empty follows the theme.", default: "" },
  showReply: { type: "boolean", label: "Show agent replies", description: "Draw a rectangle for each of these rows.", default: true },
  colorReply: { type: "string", label: "Agent replies colour", description: "A colour as #rrggbb. Empty follows the theme.", default: "" },
  showWork: { type: "boolean", label: "Show work", description: "Draw a rectangle for each of these rows.", default: true },
  colorWork: { type: "string", label: "Work colour", description: "A colour as #rrggbb. Empty follows the theme.", default: "" },
  showError: { type: "boolean", label: "Show errors", description: "Draw a rectangle for each of these rows.", default: true },
  colorError: { type: "string", label: "Errors colour", description: "A colour as #rrggbb. Empty follows the theme.", default: "" },
  showSystem: { type: "boolean", label: "Show system notes", description: "Draw a rectangle for each of these rows.", default: true },
  colorSystem: { type: "string", label: "System notes colour", description: "A colour as #rrggbb. Empty follows the theme.", default: "" },
  keepNarrow: {
    type: "boolean",
    label: "Keep the minimap on narrow windows",
    description: "When the window is too narrow for the full strip, BB's own scrollbar normally comes back. On: the minimap stays, at the narrow width.",
    default: true,
  },
  narrowWidth: {
    type: "number",
    label: "Narrow width (px)",
    description: "How wide the minimap is on a window too narrow for the full width, from 4 to 60. Only with the minimap kept on narrow windows.",
    default: 14,
    min: 4,
    max: 60,
  },
  keepScrollbar: {
    type: "boolean",
    label: "Always show the scrollbar",
    description: "With the scrollbar kept, BB still fades it out after scrolling. On: it stays shown, so it works as a second position indicator.",
    default: false,
  },
  hoverPreview: {
    type: "boolean",
    label: "Preview on hover",
    description: "A note beside the minimap says what the rectangle under the pointer is, with the start of its message.",
    default: true,
  },
  hideWhenFits: {
    type: "boolean",
    label: "Hide when the thread fits",
    description: "A short thread has nothing to scroll, and the native scrollbar goes away. On: the minimap does too, instead of spreading a few messages over the full height.",
    default: true,
  },
  showMenu: {
    type: "boolean",
    label: "Show in thread menus",
    description: "The Minimap entry in each thread's actions menu, which opens the settings.",
    default: true,
  },
} as const satisfies Record<string, BoolDef | NumDef | StrDef>;

type All = typeof SETTINGS;
type KeysOf<T extends string> = { [K in keyof All]: All[K] extends { type: T } ? K : never }[keyof All];
/** The on/off settings. */
export type SettingKey = KeysOf<"boolean">;
/** The number settings the panel's sliders write. */
export type NumberKey = KeysOf<"number">;
/** The colour settings: the viewport slider's, and one for each kind of rectangle ("" is the theme's own). */
export type ColorKey = KeysOf<"string">;

function keysOf<T extends string>(type: string): [KeysOf<T>, ...KeysOf<T>[]] {
  return (Object.keys(SETTINGS) as (keyof All)[]).filter((key) => SETTINGS[key].type === type) as never;
}
export const SETTING_KEYS = keysOf<"boolean">("boolean");
export const NUMBER_KEYS = keysOf<"number">("number");
export const COLOR_KEYS = keysOf<"string">("string");

/** The range each number is held to. */
export const NUMBER_RANGES = Object.fromEntries(NUMBER_KEYS.map((key) => [key, [SETTINGS[key].min, SETTINGS[key].max] as const])) as {
  [K in NumberKey]: readonly [number, number];
};

/** A number setting held to its range, rounded, or its default when it is not a number. */
export function readNumber(values: Record<string, unknown> | undefined, key: NumberKey): number {
  const [min, max] = NUMBER_RANGES[key];
  const value = values?.[key];
  return Math.round(Math.min(max, Math.max(min, typeof value === "number" && Number.isFinite(value) ? value : SETTINGS[key].default)));
}

/** What each kind of rectangle is called, for the settings. */
export const BLOCKS = [
  { kind: "user", name: "Your messages", note: "Right-aligned, as wide as the message" },
  { kind: "reply", name: "Agent replies", note: "Full width" },
  { kind: "work", name: "Work", note: "Tool runs and Worked-for rows" },
  { kind: "error", name: "Errors", note: "Failed turns and error notes" },
  { kind: "system", name: "System notes", note: "Everything else" },
] as const;
