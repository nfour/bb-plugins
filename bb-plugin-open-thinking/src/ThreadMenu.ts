import { useCallback } from "react";
import {
  experimental_THREAD_ACTION_GROUPS as GROUPS,
  experimental_usePluginId as usePluginId,
  useRpc,
  type PluginThreadActionRegistration,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { useOptions, type Options } from "./options";
import { LABELS, SETTING_KEYS, type SettingKey } from "./shared";

const SETTINGS = "settings";
const NEEDS_OPEN = "Switch on opening thinking first: the other options only apply to thinking the plugin opens.";

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

/** "Open thinking" in a thread's actions menu: a submenu that switches the options. The options are global; the menu is only where they are reached. */
export const threadMenu: PluginThreadActionRegistration<Data> = {
  id: "options",
  title: "Open thinking",
  icon: "AiBrain01",
  group: GROUPS.settings,
  order: 101,
  useData,
  item: ({ data }) => {
    const { options } = data;
    if (!options.ready) return null;
    const on = options.autoExpand;
    return {
      label: "Open thinking",
      detail: on ? "On" : "Off",
      icon: "AiBrain01",
      choices: {
        items: [
          ...SETTING_KEYS.map((key) => ({
            id: key,
            label: LABELS[key],
            selected: options[key],
            disabled: key !== "autoExpand" && !on,
          })),
          { id: SETTINGS, label: "Plugin settings", icon: "Settings" as const },
        ],
        hint: on ? undefined : NEEDS_OPEN,
      },
      run: ({ value }) => {
        if (value === SETTINGS) data.openSettings();
        else if (SETTING_KEYS.some((key) => key === value)) data.toggle(value as SettingKey);
      },
    };
  },
};
