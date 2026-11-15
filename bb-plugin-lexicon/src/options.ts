import { useSettings } from "@get-bb/plugin-sdk/app";
import type { SettingKey } from "../server";
import { KIND_KEYS, KINDS, type Kind } from "./lexicon";

/** Every switch is on unless listed here. */
const OFF_BY_DEFAULT: readonly SettingKey[] = ["proposals"];

export interface Options extends Record<SettingKey, boolean> {
  /** The saved settings have arrived; until then the defaults stand. */
  ready: boolean;
}

export const defaultOf = (key: SettingKey): boolean => !OFF_BY_DEFAULT.includes(key);

export function useOptions(): Options {
  const { values, isLoading } = useSettings();
  const read = (key: SettingKey) => (typeof values?.[key] === "boolean" ? (values[key] as boolean) : defaultOf(key));
  const all = {} as Record<SettingKey, boolean>;
  for (const key of ["enabled", "symbols", "agents", "proposals", "paintPrompts", ...Object.values(KIND_KEYS)] as SettingKey[]) all[key] = read(key);
  return { ...all, ready: !isLoading };
}

/** The kinds that are switched on. */
export const kindsOn = (options: Options): Kind[] => KINDS.filter((kind) => options[KIND_KEYS[kind]]);
