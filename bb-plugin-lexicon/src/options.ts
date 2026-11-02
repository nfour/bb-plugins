import { useSettings } from "@get-bb/plugin-sdk/app";
import type { SettingKey } from "../server";

export const DEFAULTS: Record<SettingKey, boolean> = { enabled: true, symbols: true, agents: true, proposals: false };

export interface Options extends Record<SettingKey, boolean> {
  /** The saved settings have arrived; until then the defaults stand. */
  ready: boolean;
}

export function useOptions(): Options {
  const { values, isLoading } = useSettings();
  const read = (key: SettingKey) => (typeof values?.[key] === "boolean" ? (values[key] as boolean) : DEFAULTS[key]);
  return { ready: !isLoading, enabled: read("enabled"), symbols: read("symbols"), agents: read("agents"), proposals: read("proposals") };
}
