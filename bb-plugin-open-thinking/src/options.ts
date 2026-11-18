import { useSettings } from "@get-bb/plugin-sdk/app";
import { DEFAULTS, SETTING_KEYS, type SettingKey } from "./shared";

export type Options = Record<SettingKey, boolean> & {
  /** False until the saved settings have arrived; before that every option is its default. */
  ready: boolean;
};

/** The saved settings, with the defaults filling anything not yet loaded. */
export function useOptions(): Options {
  const { values, isLoading } = useSettings();
  const flags = Object.fromEntries(
    SETTING_KEYS.map((key) => [key, typeof values?.[key] === "boolean" ? (values[key] as boolean) : DEFAULTS[key]]),
  ) as Record<SettingKey, boolean>;
  return { ...flags, ready: !isLoading };
}
