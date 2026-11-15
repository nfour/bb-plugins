import { useSettings } from "@get-bb/plugin-sdk/app";
import { DEFAULTS, DEFAULT_HALVES, HALVES, SETTING_KEYS, type Halves, type SettingKey } from "./shared";

export type Options = Record<SettingKey, boolean> & {
  /** Which halves of the bar are drawn. */
  halves: Halves;
  /** False until the saved settings have arrived; before that every option is its default. */
  ready: boolean;
};

/** The saved settings, with the defaults filling anything not yet loaded. */
export function useOptions(): Options {
  const { values, isLoading } = useSettings();
  const read = (key: SettingKey) => (typeof values?.[key] === "boolean" ? (values[key] as boolean) : DEFAULTS[key]);
  const halves = values?.halves;
  const flags = Object.fromEntries(SETTING_KEYS.map((key) => [key, read(key)])) as Record<SettingKey, boolean>;
  return { ...flags, ready: !isLoading, halves: HALVES.find((one) => one === halves) ?? DEFAULT_HALVES };
}
