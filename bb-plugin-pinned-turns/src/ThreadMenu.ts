import { useCallback } from "react";
import {
  experimental_THREAD_ACTION_GROUPS as GROUPS,
  experimental_usePluginId as usePluginId,
  useRpc,
  type PluginThreadActionRegistration,
} from "@get-bb/plugin-sdk/app";
import type { SettingKey, rpcContract } from "../server";
import { HALVES, type Halves } from "./halves";
import { useOptions, type Options } from "./options";
import { useCanHover, useCounterRoom } from "./viewport";

/** The options the submenu switches, in its order, after the bar's own on/off. */
const OPTIONS: { key: SettingKey; label: string }[] = [
  { key: "showStatus", label: "Turn status" },
  { key: "showPosition", label: "Turn counter" },
  { key: "showFullText", label: "Full text on hover" },
  { key: "debugLog", label: "Debug log" },
];

/** The bar's halves as menu rows; one is selected at a time. */
const HALF_CHOICES: { value: Halves; label: string }[] = [
  { value: "both", label: "Message and reply" },
  { value: "message", label: "Message only" },
  { value: "reply", label: "Reply only" },
];
const HALF_PREFIX = "halves:";
const SETTINGS = "settings";

/**
 * Opens this plugin's page in BB's settings in place. The SDK has no call for it, so
 * this pushes the route and tells BB's router; a plain link would reload the page.
 */
function openSettings(pluginId: string) {
  history.pushState(null, "", `/settings/plugins/${pluginId}`);
  window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
}

interface Data {
  options: Options;
  /** Why an option cannot do anything here, by key. */
  unavailable: Partial<Record<SettingKey, string>>;
  toggle(key: SettingKey): void;
  setHalves(value: Halves): void;
  openSettings(): void;
}

/** Read once for the whole app by BB, not per thread: the options are global. */
function useData(): Data {
  const rpc = useRpc<typeof rpcContract>();
  const options = useOptions();
  const pluginId = usePluginId();
  const unavailable: Data["unavailable"] = {};
  if (!useCounterRoom()) unavailable.showPosition = "The turn counter needs a wider thread view.";
  if (!useCanHover()) unavailable.showFullText = "Full text on hover needs a pointer that can hover.";
  // Each choice is a plugin setting, written through the backend because the page can only read them.
  const toggle = useCallback(
    (key: SettingKey) => void rpc.call("set_setting", { key, value: !options[key] }).catch(() => {}),
    [rpc, options],
  );
  const setHalves = useCallback((value: Halves) => void rpc.call("set_halves", { value }).catch(() => {}), [rpc]);
  return { options, unavailable, toggle, setHalves, openSettings: () => openSettings(pluginId) };
}

/**
 * "Pinned turns" in a thread's actions menu: a submenu that switches the bar and
 * each of its options, with a check beside the ones that are on. The options are
 * the same for every thread; the menu is only where they are reached.
 */
export const threadMenu: PluginThreadActionRegistration<Data> = {
  id: "options",
  title: "Pinned turns",
  icon: "Pin",
  group: GROUPS.settings,
  order: 100,
  useData,
  item: ({ data }) => {
    const { options, unavailable } = data;
    // Hidden for good until the setting is switched back on in the plugin's settings.
    if (!options.ready || !options.showPinButton) return null;
    const on = options.enabled;
    return {
      label: "Pinned turns",
      detail: on ? "On" : "Off",
      icon: "Pin",
      choices: {
        items: [
          { id: "enabled", label: "Pin the current turn", selected: on },
          ...HALF_CHOICES.map(({ value, label }) => ({ id: HALF_PREFIX + value, label, selected: options.halves === value, disabled: !on })),
          ...OPTIONS.map(({ key, label }) => ({
            id: key,
            label,
            selected: options[key],
            disabled: key !== "debugLog" && (!on || key in unavailable),
          })),
          { id: SETTINGS, label: "Plugin settings", icon: "Settings" as const },
        ],
        hint: Object.values(unavailable).join(" ") || undefined,
      },
      run: ({ value }) => {
        if (value === SETTINGS) data.openSettings();
        else if (typeof value === "string" && value.startsWith(HALF_PREFIX)) {
          const picked = HALVES.find((one) => one === value.slice(HALF_PREFIX.length));
          if (picked) data.setHalves(picked);
        }
        else if (value === "enabled" || OPTIONS.some((option) => option.key === value)) data.toggle(value as SettingKey);
      },
    };
  },
};
