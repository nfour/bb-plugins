// bb-plugin-minimap — backend entry.
//
// Owns the settings. The strip is drawn in the page by app.tsx, which reads each
// thread's timeline with useSdk(); the page calls back here only to write a setting
// (the frontend can read plugin settings but not write them).
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { BLOCKS, COLOR_KEYS, NUMBER_KEYS, NUMBER_RANGES, SETTING_KEYS, SETTINGS } from "./src/shared";

export { BLOCKS, COLOR_KEYS, NUMBER_RANGES, SETTING_KEYS };
export type { ColorKey, NumberKey, SettingKey } from "./src/shared";

/** The viewport slider's colour: "#rrggbb", or empty for the theme's text colour. */
export const COLOR_PATTERN = /^(#[0-9a-fA-F]{6})?$/;

export const rpcContract = defineRpcContract({
  set_setting: { input: z.object({ key: z.enum(SETTING_KEYS), value: z.boolean() }), output: z.null() },
  set_number: { input: z.object({ key: z.enum(NUMBER_KEYS), value: z.number() }), output: z.null() },
  reset: { input: z.object({}), output: z.null() },
  set_color: { input: z.object({ key: z.enum(COLOR_KEYS), value: z.string().regex(COLOR_PATTERN) }), output: z.null() },
});

export default async function plugin(bb: BbPluginApi) {
  // The ranges are ours (held where a number is written and read), not part of BB's definition.
  const definitions = Object.fromEntries(
    Object.entries(SETTINGS).map(([key, { min: _min, max: _max, ...definition }]: [string, Record<string, unknown>]) => [key, definition]),
  );
  const settings = bb.settings.define(definitions as unknown as typeof SETTINGS);
  bb.rpc.register(rpcContract, {
    reset: async () => {
      await settings.experimental_set(Object.fromEntries(Object.entries(SETTINGS).map(([key, { default: value }]) => [key, value])) as never);
      return null;
    },
    set_setting: async ({ key, value }) => {
      await settings.experimental_set({ [key]: value });
      return null;
    },
    set_color: async ({ key, value }) => {
      await settings.experimental_set({ [key]: value.toLowerCase() });
      return null;
    },
    set_number: async ({ key, value }) => {
      const [min, max] = NUMBER_RANGES[key];
      await settings.experimental_set({ [key]: Math.round(Math.min(max, Math.max(min, value))) });
      return null;
    },
  });
  bb.log.info("loaded");
  bb.onDispose(() => bb.log.info("disposed"));
}
