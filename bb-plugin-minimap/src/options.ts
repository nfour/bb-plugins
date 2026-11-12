import { useSettings } from "@get-bb/plugin-sdk/app";
import { NUMBER_RANGES, SETTINGS, SETTING_KEYS, SHARE_KEYS, readNumber, type ColorKey, type NumberKey, type SettingKey } from "./shared";
import type { Kind } from "./model.ts";
import type { Options as StripOptions } from "./strip";
import { usePreview } from "./usePreview";

/** What a setting is until the server says otherwise: the list's defaults. */
const DEFAULTS = Object.fromEntries(SETTING_KEYS.map((key) => [key, SETTINGS[key].default])) as Record<SettingKey, boolean>;

/** The settings of each kind of rectangle: its show switch and its colour. */
export const BLOCK_KEYS: Record<Kind, { show: SettingKey; color: ColorKey }> = {
  user: { show: "showUser", color: "colorUser" },
  reply: { show: "showReply", color: "colorReply" },
  work: { show: "showWork", color: "colorWork" },
  error: { show: "showError", color: "colorError" },
  system: { show: "showSystem", color: "colorSystem" },
};

export type Options = Record<SettingKey, boolean> &
  Record<NumberKey, number> & {
    /** False until the saved settings have arrived; before that every option is its default. */
    ready: boolean;
    /** "#rrggbb" for the viewport slider, "" for the theme's. */
    sliderColor: string;
    /** "#rrggbb" for each kind that has its own colour, "" for the theme's. */
    colors: Record<Kind, string>;
  };

const hex = (value: unknown) => (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "");

/** The saved settings (with what a control is previewing over them), with the defaults filling anything not yet loaded. Percentages are shares, 0 to 1. */
export function useOptions(): Options {
  const { values: saved, isLoading } = useSettings();
  // A control being dragged shows its value over the saved one.
  const preview = usePreview();
  const values = (Object.keys(preview).length > 0 ? { ...saved, ...preview } : saved) as Record<string, unknown> | undefined;
  const out = { ready: !isLoading } as Record<string, unknown>;
  for (const key of SETTING_KEYS) out[key] = typeof values?.[key] === "boolean" ? values[key] : DEFAULTS[key];
  const numbers = Object.keys(NUMBER_RANGES) as NumberKey[];
  for (const key of numbers) out[key] = readNumber(values, key);
  for (const key of SHARE_KEYS) out[key] = (out[key] as number) / 100;
  out.sliderColor = hex(values?.sliderColor);
  const colors = {} as Record<Kind, string>;
  for (const kind of Object.keys(BLOCK_KEYS) as Kind[]) colors[kind] = hex(values?.[BLOCK_KEYS[kind].color]);
  out.colors = colors;
  return out as Options;
}

/** What the strip is told, from the options: each field it uses, and no more. */
export function stripOptions(options: Options): StripOptions {
  const show = {} as Record<Kind, boolean>;
  for (const kind of Object.keys(BLOCK_KEYS) as Kind[]) show[kind] = options[BLOCK_KEYS[kind].show];
  return {
    hideScrollbar: options.hideScrollbar,
    showOutline: options.showOutline,
    fadeIdle: options.fadeIdle,
    edgeShadow: options.edgeShadow,
    clickSmooth: options.clickSmooth,
    wheelSmooth: options.wheelSmooth,
    wheelSpeed: options.wheelSpeed,
    edgeOver: options.edgeOver,
    edgeRight: options.edgeRight,
    edgeDarkOnly: options.edgeDarkOnly,
    edgeTheme: options.edgeTheme,
    edgeStrength: options.edgeStrength,
    edgeReach: options.edgeReach,
    opacity: options.opacity,
    idleOpacity: options.idleOpacity,
    hideToc: options.hideToc,
    width: options.width,
    keepScrollbar: options.keepScrollbar,
    sliderRound: options.sliderRound,
    sliderOpacity: options.sliderOpacity,
    sliderThickness: options.sliderThickness,
    sliderColor: options.sliderColor,
    keepNarrow: options.keepNarrow,
    hideWhenFits: options.hideWhenFits,
    hoverPreview: options.hoverPreview,
    hoverContext: options.hoverContext,
    hoverLines: options.hoverLines,
    hoverAnimate: options.hoverAnimate,
    hoverSlideMs: options.hoverSlideMs,
    hoverBlur: options.hoverBlur,
    hoverDelay: options.hoverDelay,
    narrowWidth: options.narrowWidth,
    show,
    colors: options.colors,
  };
}
