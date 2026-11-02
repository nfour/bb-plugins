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
  { key: "enabled", label: "Colour the project's terms" },
  { key: "symbols", label: "Learn names from the source" },
  { key: "agents", label: "Let agents maintain the lexicon" },
  { key: "proposals", label: "Agents propose terms for review" },
];

const SETTINGS = "settings";

/** Opens this plugin's page in BB's settings in place (the SDK has no call for it; same as Chat Dock). */
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
  const toggle = useCallback(
    (key: SettingKey) => void rpc.call("set_setting", { key, value: !options[key] }).catch(() => {}),
    [rpc, options],
  );
  return { options, toggle, openSettings: () => openSettings(pluginId) };
}

/** "Lexicon" in a thread's actions menu: a submenu with a check beside each option that is on. */
export const threadMenu: PluginThreadActionRegistration<Data> = {
  id: "options",
  title: "Lexicon",
  icon: "BookOpen",
  group: GROUPS.settings,
  order: 102,
  useData,
  item: ({ data }) => {
    const { options } = data;
    if (!options.ready) return null;
    return {
      label: "Lexicon",
      detail: options.enabled ? "On" : "Off",
      icon: "BookOpen",
      choices: {
        items: [
          ...OPTIONS.map(({ key, label }) => ({ id: key, label, selected: options[key], disabled: (key !== "enabled" && !options.enabled) || (key === "proposals" && !options.agents) })),
          { id: SETTINGS, label: "Plugin settings", icon: "Settings" as const },
        ],
      },
      run: ({ value }) => {
        if (value === SETTINGS) data.openSettings();
        else if (OPTIONS.some((option) => option.key === value)) data.toggle(value as SettingKey);
      },
    };
  },
};
