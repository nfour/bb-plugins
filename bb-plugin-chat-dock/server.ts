// bb-plugin-chat-dock — backend entry.
//
// Owns the settings and the debug log. Everything the user sees happens in the page
// (app.tsx); it calls back here only to write a setting (the frontend can read
// plugin settings but not write them) and to hand over debug lines.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { definitions, SETTING_KEYS } from "./src/shared";

export type { SettingKey } from "./src/shared";

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
  const settings = bb.settings.define(definitions());
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
