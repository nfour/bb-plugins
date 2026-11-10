import {
  experimental_THREAD_ACTION_GROUPS as GROUPS,
  type PluginThreadActionRegistration,
} from "@get-bb/plugin-sdk/app";
import { useOptions, type Options } from "./options";
import { setPanelOpen } from "./panelState";

interface Data {
  options: Options;
}

/** "Minimap" in a thread's actions menu: one entry that opens the settings panel, where every option lives. */
export const threadMenu: PluginThreadActionRegistration<Data> = {
  id: "options",
  title: "Minimap",
  icon: "ListView",
  group: GROUPS.settings,
  order: 101,
  useData: () => ({ options: useOptions() }),
  item: ({ data }) => {
    const { options } = data;
    // Gone for good until the setting is switched back on in the plugin's settings.
    if (!options.ready || !options.showMenu) return null;
    return {
      label: "Minimap",
      detail: "Show settings",
      icon: "ListView",
      run: () => setPanelOpen(true),
    };
  },
};
