import {
  experimental_THREAD_ACTION_GROUPS as GROUPS,
  type PluginThreadActionRegistration,
} from "@get-bb/plugin-sdk/app";
import { setPanelOpen } from "./panelState";

/** "Reply Style" in a thread's actions menu: opens the settings panel over the chat, so a change shows on the replies as it is made. */
export const threadMenu: PluginThreadActionRegistration<null> = {
  id: "settings",
  title: "Reply Style",
  icon: "MessageSquare",
  group: GROUPS.settings,
  order: 104,
  useData: () => null,
  item: () => ({
    label: "Reply Style",
    detail: "Show settings",
    icon: "MessageSquare",
    run: () => setPanelOpen(true),
  }),
};
