import { useEffect, useState } from "react";
import { experimental_Icon as Icon, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { DOCK_ICON } from "./icons";
import { useOptions } from "./options";

/** The button's marker, for the guard below to recognise it. */
const BUTTON_ATTR = "data-chat-dock-button";

/**
 * BB's composer expands on any trusted pointer-down inside it, and that handler
 * runs in React's capture phase, ahead of anything the button could do. The
 * event is stopped at the document, before React's root listener, so the
 * composer never sees it; the button's click still arrives.
 */
function installButtonGuard(): () => void {
  const guard = (event: PointerEvent) => {
    if (!event.isTrusted || !(event.target instanceof Element) || !event.target.closest(`[${BUTTON_ATTR}]`)) return;
    event.stopPropagation();
  };
  document.addEventListener("pointerdown", guard, true);
  return () => document.removeEventListener("pointerdown", guard, true);
}

/**
 * The dock button in the composer's action row, so it travels with the shell. It
 * switches docking on and off; the other options are in the thread menu
 * (`ThreadMenu.ts`).
 */
export function DockButton() {
  const { ready, showButton, enabled } = useOptions();
  const rpc = useRpc<typeof rpcContract>();
  // Shown until the saved value arrives, so a click answers at once.
  const [pending, setPending] = useState<boolean | null>(null);
  useEffect(installButtonGuard, []);
  useEffect(() => {
    if (pending === enabled) setPending(null);
  }, [pending, enabled]);

  // Hidden until the setting is switched back on in the thread menu or the plugin's settings.
  if (!ready || !showButton) return null;
  const on = pending ?? enabled;

  return (
    <button
      type="button"
      title={on ? "Stop docking: keep the composer under the timeline" : "Dock the composer in the right panel"}
      aria-label="Dock the composer in the right panel"
      aria-pressed={on}
      {...{ [BUTTON_ATTR]: "" }}
      // No focus on click: focus inside the composer expands it too.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        setPending(!on);
        rpc.call("set_setting", { key: "enabled", value: !on }).catch(() => setPending(null));
      }}
      className="chat-dock-button"
    >
      <Icon name={DOCK_ICON} fallback="PanelRight" className="chat-dock-icon" aria-hidden />
    </button>
  );
}
