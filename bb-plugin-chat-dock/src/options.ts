import { useSettings } from "@get-bb/plugin-sdk/app";
import type { SettingKey } from "../server";

/** What a setting is until the server says otherwise; the same defaults as `server.ts`. */
export const DEFAULTS: Record<SettingKey, boolean> = {
  enabled: true,
  locked: true,
  keepDocked: false,
  showButton: true,
  debugLog: false,
};

export type Options = Record<SettingKey, boolean> & {
  /** False until the saved settings have arrived; before that every option is its default. */
  ready: boolean;
};

/** The saved settings, with the defaults filling anything not yet loaded. */
export function useOptions(): Options {
  const { values, isLoading } = useSettings();
  const read = (key: SettingKey) => (typeof values?.[key] === "boolean" ? (values[key] as boolean) : DEFAULTS[key]);
  return { ready: !isLoading, enabled: read("enabled"), locked: read("locked"), keepDocked: read("keepDocked"), showButton: read("showButton"), debugLog: read("debugLog") };
}
