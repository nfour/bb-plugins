import { useCallback } from "react";
import {
  experimental_THREAD_ACTION_GROUPS as GROUPS,
  useBbNavigate,
  useRpc,
  type PluginThreadActionRegistration,
} from "@get-bb/plugin-sdk/app";
import type { SettingKey, rpcContract } from "../server";
import { collector } from "./collector";
import { useOptions, type Options } from "./options";

/** The switches in the submenu, in its order. */
const OPTIONS: { key: SettingKey; label: string }[] = [
  { key: "enabled", label: "Measure" },
  { key: "writeFile", label: "Write the metrics file" },
  { key: "sampleServer", label: "Sample the server" },
];

const DASHBOARD = "dashboard";
const LAGGED = "lagged";

interface Data {
  options: Options;
  toggle(key: SettingKey): void;
  openDashboard(): void;
}

/** Read once for the whole app by BB, not per thread: the options are global. */
function useData(): Data {
  const rpc = useRpc<typeof rpcContract>();
  const options = useOptions();
  const navigate = useBbNavigate();
  // Each choice is a plugin setting, written through the backend because the page can only read them.
  const toggle = useCallback(
    (key: SettingKey) => void rpc.call("set_setting", { key, value: !options[key] }).catch(() => {}),
    [rpc, options],
  );
  const openDashboard = useCallback(() => navigate.toPluginPanel("performance"), [navigate]);
  return { options, toggle, openDashboard };
}

/** "Performance" in a thread's actions menu: a submenu with a check beside each option that is on. */
export const threadMenu: PluginThreadActionRegistration<Data> = {
  id: "options",
  title: "Performance",
  icon: "TimeSchedule",
  group: GROUPS.settings,
  order: 102,
  useData,
  item: ({ data }) => {
    const { options } = data;
    if (!options.ready) return null;
    return {
      label: "Performance",
      detail: options.enabled ? "On" : "Off",
      icon: "TimeSchedule",
      choices: {
        items: [
          ...OPTIONS.map(({ key, label }) => ({ id: key, label, selected: options[key] })),
          { id: LAGGED, label: "This lagged", icon: "Clock" as const },
          { id: DASHBOARD, label: "Open the dashboard", icon: "TimeSchedule" as const },
        ],
      },
      run: ({ value }) => {
        if (value === DASHBOARD) data.openDashboard();
        else if (value === LAGGED) void collector.mark();
        else if (OPTIONS.some((option) => option.key === value)) data.toggle(value as SettingKey);
      },
    };
  },
};
