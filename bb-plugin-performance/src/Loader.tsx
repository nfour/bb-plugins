import { useEffect, useRef } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { collector, type Call } from "./collector";
import { useOptions } from "./options";

/**
 * Renders nothing. A content script has no React, so this overlay, mounted on
 * every page, reads the saved settings and the RPC and hands them to the
 * collector (src/collector.ts); both are in one bundle. Measuring waits for the
 * saved settings, so a plugin switched off never attaches an observer.
 */
export function Loader() {
  const { enabled, ready } = useOptions();
  const rpc = useRpc<typeof rpcContract>();
  // The RPC handle may be a new object on every render; going through a ref keeps the effect (which attaches and detaches the observers) to real changes of the setting.
  const latest = useRef(rpc);
  latest.current = rpc;
  useEffect(() => {
    const call: Call = (method, input) => latest.current.call(method, input as never);
    collector.configure({ enabled: ready && enabled, call });
    return () => collector.configure({ enabled: false, call });
  }, [enabled, ready]);
  return null;
}
