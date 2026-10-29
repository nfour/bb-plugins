import { useCallback } from "react";
import {
  experimental_THREAD_ACTION_GROUPS as GROUPS,
  experimental_usePluginId as usePluginId,
  useRpc,
  type PluginThreadActionRegistration,
} from "@get-bb/plugin-sdk/app";
import type { SettingKey, rpcContract } from "../server";
import { useOptions, type Options } from "./options";

/** The switches in the submenu, in its order. */
const OPTIONS: { key: SettingKey; label: string }[] = [
  { key: "enabled", label: "Dock the composer in the right panel" },
  { key: "locked", label: "Keep it at the panel's bottom" },
  { key: "keepDocked", label: "Keep composer docked" },
  { key: "showButton", label: "Dock button in the composer" },
  { key: "debugLog", label: "Debug log" },
];

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
  toggle(key: SettingKey): void;
  openSettings(): void;
}

/** Read once for the whole app by BB, not per thread: the options are global. */
function useData(): Data {
  const rpc = useRpc<typeof rpcContract>();
  const options = useOptions();
  const pluginId = usePluginId();
  // Each choice is a plugin setting, written through the backend because the page can only read them.
  const toggle = useCallback(
    (key: SettingKey) => void rpc.call("set_setting", { key, value: !options[key] }).catch(() => {}),
    [rpc, options],
  );
  return { options, toggle, openSettings: () => openSettings(pluginId) };
}

/**
 * "Chat dock" in a thread's actions menu: a submenu with a check beside each
 * option that is on. The options are the same for every thread.
 */
export const threadMenu: PluginThreadActionRegistration<Data> = {
  id: "options",
  title: "Chat dock",
  icon: "PanelRight",
  group: GROUPS.settings,
  order: 101,
  useData,
  item: ({ data }) => {
    const { options } = data;
    if (!options.ready) return null;
    return {
      label: "Chat dock",
      detail: options.enabled ? (options.locked ? "Strip" : "Chat tab") : "Off",
      icon: "PanelRight",
      choices: {
        items: [
          ...OPTIONS.map(({ key, label }) => ({
            id: key,
            label,
            selected: options[key],
            disabled: (key === "locked" || key === "keepDocked") && !options.enabled,
          })),
          { id: SETTINGS, label: "Plugin settings", icon: "Settings" as const },
        ],
        hint: options.locked ? undefined : "Off, the composer docks as a Chat tab of its own.",
      },
      run: ({ value }) => {
        if (value === SETTINGS) data.openSettings();
        else if (OPTIONS.some((option) => option.key === value)) data.toggle(value as SettingKey);
      },
    };
  },
};
