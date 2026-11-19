/**
 * The settings, named once for the server, the page and the settings panel. Import-free on purpose:
 * the page bundle reads these values, and importing a value from `server.ts` would pull the server's
 * SDK into it.
 */

/** The panel's tabs, in order. */
export const TABS = ["Quotes", "Spoilers", "Lists", "Tables"] as const;
export type Tab = (typeof TABS)[number];

type Common = {
  label: string;
  description: string;
  /** The tab of the settings panel it is shown on. */
  tab: Tab;
};

/** An option the stylesheet reads as an attribute on <html>, written while it differs from its default. */
export type Switch = Common & {
  key: "guides" | "elbows" | "spoilerQuote" | "tables";
  default: boolean;
  attribute: string;
  value: string;
};

/** A number the stylesheet reads as a custom property on <html>, written while it differs from its default. */
export type Num = Common & {
  key: NumberKey;
  default: number;
  min: number;
  max: number;
  step?: number;
  unit: "%" | "px" | "ms";
  property: string;
};

export const SWITCHES: readonly Switch[] = [
  {
    key: "guides",
    label: "Guide Lines",
    description: "A thin line down each nesting level of a list, so an item's spoiler, quote or sub-list reads as belonging to the line above it.",
    tab: "Lists",
    default: true,
    attribute: "data-reply-style-guides",
    value: "off",
  },
  {
    key: "elbows",
    label: "Elbows",
    description: "Each nested item, spoiler and quote joins its guide line with a short stub, and the line stops at the last one, like a file tree.",
    tab: "Lists",
    default: true,
    attribute: "data-reply-style-elbows",
    value: "off",
  },
  {
    key: "spoilerQuote",
    label: "Spoiler As Quote",
    description: "Draws the quote bar on the opened part of every spoiler, so a spoiler's body needs no quote markers. A quote sitting right inside a spoiler loses its own bar, so older replies do not show two.",
    tab: "Spoilers",
    default: false,
    attribute: "data-reply-style-quote",
    value: "on",
  },
  {
    key: "tables",
    label: "Tables Surface",
    description: "Tables sit on the message's own background, so guide lines and quote bars pass under them instead of through.",
    tab: "Tables",
    default: true,
    attribute: "data-reply-style-tables",
    value: "off",
  },
];

export const NUMBER_KEYS = ["quoteBar", "quoteWidth", "quoteText", "summary", "hover", "chevron", "open", "guide", "guideWidth", "checkbox"] as const;
export type NumberKey = (typeof NUMBER_KEYS)[number];

export const NUMBERS: readonly Num[] = [
  { key: "quoteBar", label: "Bar strength", description: "How much of the text colour the quote bar takes", tab: "Quotes", default: 30, min: 0, max: 100, unit: "%", property: "--reply-style-quote-bar" },
  { key: "quoteWidth", label: "Bar width", description: "The quote bar's width, also used by Spoiler As Quote", tab: "Quotes", default: 2, min: 1, max: 6, unit: "px", property: "--reply-style-quote-width" },
  { key: "quoteText", label: "Text strength", description: "Quoted text, as a share of the text colour", tab: "Quotes", default: 80, min: 30, max: 100, unit: "%", property: "--reply-style-quote-text" },
  { key: "summary", label: "Description strength", description: "The description after a spoiler's chips, as a share of the text colour", tab: "Spoilers", default: 66, min: 20, max: 100, unit: "%", property: "--reply-style-summary" },
  { key: "hover", label: "Hover surface", description: "The shade behind a spoiler's line under the pointer", tab: "Spoilers", default: 9, min: 0, max: 30, unit: "%", property: "--reply-style-hover" },
  { key: "chevron", label: "Chevron strength", description: "The arrow before a spoiler's line", tab: "Spoilers", default: 55, min: 10, max: 100, unit: "%", property: "--reply-style-chevron" },
  { key: "open", label: "Open and close", description: "How long a spoiler takes to open or close; 0 snaps", tab: "Spoilers", default: 220, min: 0, max: 600, step: 10, unit: "ms", property: "--reply-style-open" },
  { key: "guide", label: "Line strength", description: "Guide lines, as a share of the text colour", tab: "Lists", default: 18, min: 0, max: 60, unit: "%", property: "--reply-style-guide" },
  { key: "guideWidth", label: "Line width", description: "How wide each guide line is", tab: "Lists", default: 1, min: 1, max: 4, unit: "px", property: "--reply-style-guide-width" },
  { key: "checkbox", label: "Checkbox drop", description: "How far a reply's checkboxes move down from where BB puts them, so they sit on the middle of their text", tab: "Lists", default: 2.5, min: 0, max: 6, step: 0.5, unit: "px", property: "--reply-style-checkbox" },
];

export const SETTING_KEYS = ["guides", "elbows", "spoilerQuote", "tables", ...NUMBER_KEYS] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
export type SwitchKey = Switch["key"];

/** Clamps a number setting to its range, kept to whole steps. */
export function clampNumber(key: NumberKey, value: number): number {
  const n = NUMBERS.find((x) => x.key === key)!;
  const step = n.step ?? 1;
  return Math.min(n.max, Math.max(n.min, Math.round(value / step) * step));
}

/** A setting's value from saved values (or a preview over them), falling back to its default. */
export function valueOf(values: Partial<Record<string, unknown>> | undefined, key: SettingKey): boolean | number {
  const sw = SWITCHES.find((s) => s.key === key);
  if (sw) return typeof values?.[key] === "boolean" ? (values[key] as boolean) : sw.default;
  const v = values?.[key];
  return typeof v === "number" && Number.isFinite(v) ? clampNumber(key as NumberKey, v) : NUMBERS.find((n) => n.key === key)!.default;
}

/** The attributes the page should carry on <html> for these option values; null removes one. */
export function attributesFor(values: Partial<Record<string, unknown>>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const s of SWITCHES) out[s.attribute] = valueOf(values, s.key) === s.default ? null : s.value;
  return out;
}

/** The custom properties the page should carry on <html>; null removes one, so the stylesheet's fallback applies. */
export function propertiesFor(values: Partial<Record<string, unknown>>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const n of NUMBERS) {
    const v = valueOf(values, n.key) as number;
    out[n.property] = v === n.default ? null : `${v}${n.unit}`;
  }
  return out;
}
