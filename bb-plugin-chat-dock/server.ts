// bb-plugin-chat-dock — backend entry.
//
// Owns the settings and the debug log. Everything visible happens in the page
// (app.tsx); it calls back here only to write a setting (the frontend can read
// plugin settings but not write them) and to hand over debug lines.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

/** The boolean settings the page can switch. */
export const SETTING_KEYS = ["enabled", "locked", "keepDocked", "showButton", "debugLog"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export const rpcContract = defineRpcContract({
  set_setting: { input: z.object({ key: z.enum(SETTING_KEYS), value: z.boolean() }), output: z.null() },
  debug: {
    input: z.object({
      event: z.string().max(40),
      data: z.record(z.string().max(40), z.union([z.number(), z.string().max(200), z.boolean()])),
    }),
    output: z.null(),
  },
});

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    enabled: {
      type: "boolean",
      label: "Dock the composer in the right panel",
      description: "While the panel is open, the composer and the cards above it move into it: as a strip at the panel's bottom, or as a Chat tab.",
      default: true,
    },
    locked: {
      type: "boolean",
      label: "Keep it at the panel's bottom",
      description: "A strip under whichever tab is open, so the composer never goes away while the panel is open. Off, it is a Chat tab instead.",
      default: true,
    },
    keepDocked: {
      type: "boolean",
      label: "Keep composer docked",
      description: "Keep the composer in the sidebar when it closes. Click “Return composer” to bring it back to the timeline. Useful for drafting long messages on mobile.",
      default: false,
    },
    showButton: {
      type: "boolean",
      label: "Show the dock button",
      description: "The button in the composer's action row that switches docking on and off.",
      default: true,
    },
    debugLog: {
      type: "boolean",
      label: "Debug log",
      description: "Write dock and undock events to the plugin log (`bb plugin logs chat-dock`).",
      default: false,
    },
  });
  bb.rpc.register(rpcContract, {
    set_setting: async ({ key, value }) => {
      await settings.experimental_set({ [key]: value });
      return null;
    },
    debug: async ({ event, data }) => {
      if (!(await settings.get()).debugLog) return null;
      bb.log.debug(`${event} ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(" ")}`);
      return null;
    },
  });
  bb.log.info("loaded");
  bb.onDispose(() => bb.log.info("disposed"));
}
