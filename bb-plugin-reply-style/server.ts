// bb-plugin-reply-style — backend entry.
//
// Defines the settings (BB lists them on the plugin's settings page too) and the calls the settings
// panel writes them through: the page can read plugin settings but not write them.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { NUMBERS, NUMBER_KEYS, SWITCHES, clampNumber, type SwitchKey } from "./src/shared";

const SWITCH_KEYS = SWITCHES.map((s) => s.key) as [SwitchKey, ...SwitchKey[]];

export const rpcContract = defineRpcContract({
  set_switch: { input: z.object({ key: z.enum(SWITCH_KEYS), value: z.boolean() }), output: z.null() },
  set_number: { input: z.object({ key: z.enum(NUMBER_KEYS), value: z.number() }), output: z.null() },
  reset: { input: z.object({}), output: z.null() },
});

export default async function plugin(bb: BbPluginApi) {
  const definitions: Record<string, unknown> = {};
  for (const s of SWITCHES) definitions[s.key] = { type: "boolean", label: s.label, description: s.description, default: s.default };
  for (const n of NUMBERS) definitions[n.key] = { type: "number", label: `${n.label} (${n.unit})`, description: `${n.description}, ${n.min} to ${n.max}.`, default: n.default };
  const settings = bb.settings.define(definitions as never);
  bb.rpc.register(rpcContract, {
    set_switch: async ({ key, value }) => {
      await settings.experimental_set({ [key]: value } as never);
      return null;
    },
    set_number: async ({ key, value }) => {
      await settings.experimental_set({ [key]: clampNumber(key, value) } as never);
      return null;
    },
    reset: async () => {
      const all: Record<string, unknown> = {};
      for (const s of SWITCHES) all[s.key] = s.default;
      for (const n of NUMBERS) all[n.key] = n.default;
      await settings.experimental_set(all as never);
      return null;
    },
  });
}
