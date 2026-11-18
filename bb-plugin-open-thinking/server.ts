// bb-plugin-open-thinking — backend entry.
//
// Owns the settings. The work is done in the page by app.tsx; the page calls back here only to
// write a setting (the frontend can read plugin settings but not write them).
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { DEFAULTS, LABELS, SETTING_KEYS } from "./src/shared";

export const rpcContract = defineRpcContract({
  set_setting: { input: z.object({ key: z.enum(SETTING_KEYS), value: z.boolean() }), output: z.null() },
});

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    autoExpand: {
      type: "boolean",
      label: LABELS.autoExpand,
      description: "Thinking blocks open as they stream and when they land in the thread. One you open or close yourself is left as you set it.",
      default: DEFAULTS.autoExpand,
    },
    closeOnNew: {
      type: "boolean",
      label: LABELS.closeOnNew,
      description: "Only the newest thinking on screen stays open. Does nothing while thinking blocks are not opened automatically.",
      default: DEFAULTS.closeOnNew,
    },
    closeOnFinish: {
      type: "boolean",
      label: LABELS.closeOnFinish,
      description: "When the agent's turn ends its thinking blocks close, and thinking in finished turns stays closed. Does nothing while thinking blocks are not opened automatically.",
      default: DEFAULTS.closeOnFinish,
    },
    keepLatest: {
      type: "boolean",
      label: LABELS.keepLatest,
      description: "While the agent works, BB folds the thought it just had into a group such as \"Ran 3 commands\" as soon as different work follows. This keeps the group holding the newest thought open. Does nothing while thinking blocks are not opened automatically.",
      default: DEFAULTS.keepLatest,
    },
    followGrowth: {
      type: "boolean",
      label: LABELS.followGrowth,
      description: "Thinking that streams past the height of its box scrolls to its end as it grows, until you scroll up in it yourself. Does nothing while thinking blocks are not opened automatically.",
      default: DEFAULTS.followGrowth,
    },
  });
  bb.rpc.register(rpcContract, {
    set_setting: async ({ key, value }) => {
      await settings.experimental_set({ [key]: value });
      return null;
    },
  });
  bb.log.info("loaded");
  bb.onDispose(() => bb.log.info("disposed"));
}
