// What the page and the backend both read. No imports here: the page bundle must not pull in the backend's libraries.

/**
 * `label` and `description` are what the settings API and the `bb` CLI show. The panel is smaller, so it shows `short` (its
 * label) and `hint` (one line) when there are, and the long ones otherwise; `unit` is what a slider's value ends in.
 */
type Common = { label: string; description?: string; short?: string; hint?: string };
type BoolDef = Common & { type: "boolean"; default: boolean };
type NumDef = Common & { type: "number"; default: number; min: number; max: number; unit?: string };
type StrDef = Common & { type: "string"; default: string };

/**
 * Every setting, once. The backend defines them from this list, and the defaults, the keys, the number
 * ranges and the RPC inputs are read off it, so an option is added here and where it is used, nowhere else.
 * A number is held to `min`..`max` where it is written and where it is read.
 */
export const SETTINGS = {
  enabled: { type: "boolean", label: "Show the minimap", short: "Show the minimap", hint: "A strip along the right edge, one rectangle per message", default: true },
  hideScrollbar: {
    type: "boolean",
    label: "Replace the scrollbar",
    short: "Replace the scrollbar",
    hint: "Hides the timeline scrollbar; off keeps both, lined up",
    description: "Hide the timeline's own scrollbar while the minimap shows, so there is one thing to grab.",
    default: true,
  },
  loadHistory: {
    type: "boolean",
    label: "Load the whole history",
    short: "Load the whole history",
    hint: "Reads every older page too; off reads the newest, far cheaper",
    description:
      "Fetch every older page of a long thread in the background so the minimap covers all of it. Off: only the newest page is read, which costs far less.",
    default: false,
  },
  hideToc: {
    type: "boolean",
    label: "Hide the thread-index button",
    short: "Hide the thread-index button",
    hint: "On removes it; off moves it left of the strip",
    description: "BB's thread-index button beside the scrollbar. Off: it sits just left of the minimap, which keeps the right edge.",
    default: true,
  },
  width: { type: "number", label: "Width (px)", short: "Width", hint: "6 to 120 pixels", unit: "px", description: "How wide the minimap is, from 6 to 120.", default: 26, min: 6, max: 120 },
  showOutline: {
    type: "boolean",
    label: "Show the viewport slider",
    short: "Show the viewport slider",
    hint: "The box over what is on screen; drag it to scrub",
    description: "The slider over the part of the thread on screen. Dragging, clicking and the wheel work without it.",
    default: true,
  },
  fadeIdle: {
    type: "boolean",
    label: "Fade when not hovered",
    short: "Fade when not hovered",
    hint: "Dims the rectangles until hovered; the slider stays solid",
    description: "Dim the minimap to the idle opacity until the pointer is over it.",
    default: true,
  },
  edgeShadow: {
    type: "boolean",
    label: "Shade the thread beside the strip",
    short: "Shade the thread beside the strip",
    hint: "A soft darkening from the strip's edge over the thread",
    description: "A soft drop of darkness from the strip's edge over the timeline, by default half as wide as the strip.",
    default: true,
  },
  clickSmooth: {
    type: "boolean",
    label: "Smooth scroll on click",
    short: "A click on the strip",
    hint: "Glides to the place, or jumps there",
    description: "A click on the strip glides to the place instead of jumping.",
    default: true,
  },
  wheelSmooth: {
    type: "boolean",
    label: "Smooth scroll with the wheel",
    short: "The wheel over the strip",
    hint: "Glides, with steps adding up, or jumps a step at a time",
    description: "The wheel over the strip glides, and steps in a row add up, instead of jumping.",
    default: true,
  },
  wheelSpeed: {
    type: "number",
    label: "Wheel speed (%)",
    short: "Wheel speed",
    hint: "Distance per wheel step; 200 is twice the thread's own, 25 to 1000",
    unit: "%",
    description: "How far the wheel over the strip scrolls compared with the wheel over the thread; 200 is twice as far, 25 to 1000.",
    default: 300,
    min: 25,
    max: 1000,
  },
  edgeDarkOnly: {
    type: "boolean",
    label: "No shade on a light theme",
    short: "No shade on a light theme",
    hint: "Off while the theme is light, where it looks heavy",
    description: "Switch the shade off while the theme is light, where it looks heavy.",
    default: true,
  },
  edgeRight: {
    type: "boolean",
    label: "Cast from the right edge",
    short: "Cast from",
    hint: "The strip's own edge, or the window's, crossing the strip",
    description: "Start the shade at the window's right edge, so it crosses the strip, instead of at the strip's own edge.",
    default: false,
  },
  edgeTheme: {
    type: "boolean",
    label: "Shade with the theme background",
    short: "Colour",
    hint: "Darkens with black, or fades into the theme's background",
    description: "Fade the thread into the theme's background colour instead of darkening it with black.",
    default: false,
  },
  edgeOver: {
    type: "boolean",
    label: "Shade over the rectangles",
    short: "Layer",
    hint: "Under the strip's rectangles, or over them",
    description: "Lay the shade over the strip's rectangles. Off: it lies under them, or falls only on the thread.",
    default: false,
  },
  edgeStrength: { type: "number", label: "Shade strength (%)", short: "Shade strength", hint: "How dark it is, 0 to 100", unit: "%", description: "How dark the shade is, from 0 to 100.", default: 44, min: 0, max: 100 },
  edgeReach: {
    type: "number",
    label: "Shade reach (%)",
    short: "Shade reach",
    hint: "As a share of the strip's width, 25 to 400",
    unit: "%",
    description: "How far it reaches, as a share of the strip's width, from 25 to 400.",
    default: 50,
    min: 25,
    max: 400,
  },
  opacity: {
    type: "number",
    label: "Opacity (%)",
    short: "Opacity",
    hint: "How solid the rectangles are",
    unit: "%",
    description: "How opaque the minimap is, from 0 to 100; with fading on, the opacity it returns to under the pointer.",
    default: 66,
    min: 0,
    max: 100,
  },
  idleOpacity: { type: "number", label: "Idle opacity (%)", short: "Idle opacity", hint: "How faint they get when not hovered", unit: "%", description: "The opacity while faded, from 0 to 100.", default: 33, min: 0, max: 100 },
  sliderRound: {
    type: "boolean",
    label: "Round the slider's corners",
    short: "Corners",
    hint: "Square corners, or curved ones",
    description: "The viewport slider's box has round corners; off, square ones.",
    default: true,
  },
  sliderOpacity: {
    type: "number",
    label: "Slider opacity (%)",
    short: "Opacity",
    hint: "Fading the strip never changes it",
    unit: "%",
    description: "How strong the viewport slider's line is, from 0 to 100.",
    default: 26,
    min: 0,
    max: 100,
  },
  sliderThickness: {
    type: "number",
    label: "Slider thickness (px)",
    short: "Thickness",
    hint: "1 to 6 pixels",
    unit: "px",
    description: "How thick the viewport slider's line is, from 1 to 6.",
    default: 2,
    min: 1,
    max: 6,
  },
  sliderColor: {
    type: "string",
    label: "Slider colour",
    short: "Slider colour",
    hint: "Follows the theme's text colour until you pick one",
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
    short: "Keep on narrow windows",
    hint: "Instead of handing back to the scrollbar when there is no room",
    description: "When the window is too narrow for the full strip, BB's own scrollbar normally comes back. On: the minimap stays, at the narrow width.",
    default: true,
  },
  narrowWidth: {
    type: "number",
    label: "Narrow width (px)",
    short: "Narrow width",
    hint: "4 to 60 pixels, used when there is no room",
    unit: "px",
    description: "How wide the minimap is on a window too narrow for the full width, from 4 to 60. Only with the minimap kept on narrow windows.",
    default: 12,
    min: 4,
    max: 60,
  },
  keepScrollbar: {
    type: "boolean",
    label: "Always show the scrollbar",
    short: "Always show the scrollbar",
    hint: "With the scrollbar kept: stops BB fading it out",
    description: "With the scrollbar kept, BB still fades it out after scrolling. On: it stays shown, so it works as a second position indicator.",
    default: true,
  },
  hoverPreview: {
    type: "boolean",
    label: "Preview on hover",
    short: "Preview on hover",
    hint: "A note beside the strip with the start of the message under the pointer",
    description: "A note beside the minimap says what the rectangle under the pointer is, with the start of its message.",
    default: true,
  },
  hoverContext: {
    type: "number",
    label: "Context rows",
    short: "Context rows",
    hint: "Rows above and below the pointer's, 0 to 6",
    unit: "",
    description: "Rows shown above and below the one under the pointer, from 0 to 6. 0 shows only that row; the others are quieter.",
    default: 1,
    min: 0,
    max: 6,
  },
  hoverLines: {
    type: "number",
    label: "Text lines",
    short: "Text lines",
    hint: "1 to 6 lines of each message",
    unit: "",
    description: "How many lines of a message each row of the note shows, from 1 to 6.",
    default: 2,
    min: 1,
    max: 6,
  },
  hoverAnimate: {
    type: "boolean",
    label: "Animate the note",
    short: "Animate the note",
    hint: "Glides from row to row; off swaps the text at once",
    description: "The note glides from row to row. Off: it swaps text at once.",
    default: true,
  },
  hoverSlideMs: {
    type: "number",
    label: "Glide time (ms)",
    short: "Glide time",
    hint: "Between rows, 0 to 1000 ms; 0 is instant",
    unit: "ms",
    description: "How long the note takes to glide from one row to the next, from 0 to 1000. 0 swaps at once.",
    default: 420,
    min: 0,
    max: 1000,
  },
  hoverBlur: {
    type: "number",
    label: "Glide softness (px)",
    short: "Glide softness",
    hint: "Softening at the start of a long glide, 0 to 12",
    unit: "px",
    description: "How soft the note gets at the start of a glide past many rows, from 0 to 12. 0 is none.",
    default: 6,
    min: 0,
    max: 12,
  },
  hoverDelay: {
    type: "number",
    label: "Hover delay (ms)",
    short: "Hover delay",
    hint: "Least time between rows, 0 to 500 ms",
    unit: "ms",
    description: "The note takes a new row at most this often, from 0 to 500. Higher is calmer over dense rectangles.",
    default: 66,
    min: 0,
    max: 500,
  },
  hideWhenFits: {
    type: "boolean",
    label: "Hide when the thread fits",
    short: "Hide when the thread fits",
    hint: "Gone while there is nothing to scroll, like the scrollbar",
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

/** The label the panel shows for a setting, and its one-line hint. */
export const shortOf = (key: keyof All): string => (SETTINGS[key] as Common).short ?? SETTINGS[key].label;
export const hintOf = (key: keyof All): string => (SETTINGS[key] as Common).hint ?? (SETTINGS[key] as Common).description ?? "";
/** What a slider's value ends in ("px", "%", "ms" or nothing). */
export const unitOf = (key: NumberKey): string => (SETTINGS[key] as NumDef).unit ?? "";
/** The numbers that are shares (0 to 1) in the options, and percentages (0 to 100) as saved and in the panel. */
export const SHARE_KEYS = ["opacity", "idleOpacity", "sliderOpacity", "edgeStrength"] as const;

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
