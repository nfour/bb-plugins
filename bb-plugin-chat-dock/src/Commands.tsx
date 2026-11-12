import { useEffect } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { SettingKey, rpcContract } from "../server";
import { useOptions, type Options } from "./options";

/**
 * What a command's `run` needs, which is not a component and so has no hooks:
 * the saved options and the way to write one. `Commands` below keeps it current.
 */
let live: { options: Options; set(key: SettingKey, value: boolean): Promise<unknown> } | null = null;

/** Flips a setting; nothing happens before the settings have loaded. */
export function toggleSetting(key: SettingKey): Promise<unknown> | void {
  if (!live?.options.ready) return;
  return live.set(key, !live.options[key]);
}

/** Whether a command that flips `locked` has anything to do: only while docking is on. */
export function dockingOn(): boolean {
  return live?.options.ready === true && live.options.enabled;
}

/** Renders nothing; hands the options and the RPC client to the commands (`app.tsx`). */
export function Commands() {
  const rpc = useRpc<typeof rpcContract>();
  const options = useOptions();
  useEffect(() => {
    live = { options, set: (key, value) => rpc.call("set_setting", { key, value }) };
  }, [rpc, options]);
  useEffect(() => () => void (live = null), []);
  return null;
}
