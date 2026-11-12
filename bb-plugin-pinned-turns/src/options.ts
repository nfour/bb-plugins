import { useSettings } from "@get-bb/plugin-sdk/app";
import { HALVES, type Halves, type SettingKey } from "../server";

/** What a setting is until the server says otherwise; the same defaults as `server.ts`. */
export const DEFAULTS: Record<SettingKey, boolean> = {
  enabled: true,
  showStatus: true,
  showPosition: true,
  showFullText: true,
  debugLog: false,
  showPinButton: true,
};

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
  return {
    ready: !isLoading,
    halves: HALVES.find((one) => one === halves) ?? "both",
    enabled: read("enabled"),
    showStatus: read("showStatus"),
    showPosition: read("showPosition"),
    showFullText: read("showFullText"),
    debugLog: read("debugLog"),
    showPinButton: read("showPinButton"),
  };
}
