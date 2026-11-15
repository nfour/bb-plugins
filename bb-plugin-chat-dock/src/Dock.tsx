import { useEffect, useRef } from "react";
import { configure, registerTab } from "./reconcile";
import { useOptions } from "./options";

/**
 * The body of the Chat tab. While it is mounted (the tab is the active one in its
 * pane) it is where the reconciler (`reconcile.ts`) holds the pane's composer shell, at
 * the bottom; on unmount, or while the right panel is collapsed, the shell goes
 * back to the column, so a closed panel means the default layout. Locked, the strip
 * holds the shell instead and the tab is not offered, but a tab already open stays
 * out of the way.
 */
export function Dock() {
  const slot = useRef<HTMLDivElement | null>(null);
  const { ready, enabled, locked } = useOptions();

  // This root often learns of a switch of the lock before the overlay's does; saying so now lets the shell move once.
  useEffect(() => {
    configure({ ready, enabled, locked });
  }, [ready, enabled, locked]);
  useEffect(() => (slot.current ? registerTab(slot.current) : undefined), []);

  return (
    <div className="chat-dock-tab">
      <div className="chat-dock-tab-space" />
      <div ref={slot} data-chat-dock-host="tab" className="chat-dock-tab-host" />
    </div>
  );
}
