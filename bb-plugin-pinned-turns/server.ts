// bb-plugin-pinned-turns — backend entry.
//
// Owns the settings and the debug log. The bar is drawn in the page by app.tsx,
// which reads the timeline with useSdk(); the page calls back here only to write a
// setting (the frontend can read plugin settings but not write them) and to hand
// over debug lines (the frontend has no plugin logger).
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

/** The boolean settings the thread menu switches. */
export const SETTING_KEYS = ["enabled", "showStatus", "showPosition", "showFullText", "debugLog", "showPinButton"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/** Which halves of the bar are drawn. */
export const HALVES = ["both", "message", "reply"] as const;
export type Halves = (typeof HALVES)[number];

export const rpcContract = defineRpcContract({
  set_setting: { input: z.object({ key: z.enum(SETTING_KEYS), value: z.boolean() }), output: z.null() },
  set_halves: { input: z.object({ value: z.enum(HALVES) }), output: z.null() },
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
    enabled: { type: "boolean", label: "Pin the current turn", default: true },
    showStatus: {
      type: "boolean",
      label: "Show turn status",
      description: "Your message and the reply pulse while the turn runs; a dot marks a reply that failed or was interrupted.",
      default: true,
    },
    showPosition: {
      type: "boolean",
      label: "Show turn counter",
      description: "Which of the thread's turns the pinned message is, like 7/23.",
      default: true,
    },
    showFullText: {
      type: "boolean",
      label: "Show full text on hover",
      description: "A tooltip with the whole message when the bar had to cut it short.",
      default: true,
    },
    showPinButton: {
      type: "boolean",
      label: "Show in thread menus",
      description: "The Pinned turns submenu in each thread's actions menu, where the bar and its options are switched.",
      default: true,
    },
    halves: {
      type: "string",
      label: "Halves shown",
      description: "both, message (only the message you are under) or reply (only the latest reply).",
      default: "both",
    },
    debugLog: {
      type: "boolean",
      label: "Debug log",
      description: "Write timeline fetch timing to the plugin log (`bb plugin logs pinned-turns`).",
      default: false,
    },
  });
  bb.rpc.register(rpcContract, {
    set_setting: async ({ key, value }) => {
      await settings.experimental_set({ [key]: value });
      return null;
    },
    set_halves: async ({ value }) => {
      await settings.experimental_set({ halves: value });
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
