// bb-plugin-chat-dock — frontend entry.
//
// Moves BB's own composer shell (the box, the cards above it, the chips under
// it) out of the chat column while the thread's right panel is open: into a
// fixed Chat tab, or, locked, into a strip under whichever tab is open. React
// and @get-bb/plugin-sdk/app are provided by BB at load time, never bundled.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { Dock } from "./src/Dock";
import { Return } from "./src/Return";
import { DockButton } from "./src/DockButton";
import { DOCK_ICON, DockIcon } from "./src/icons";
import { useOptions } from "./src/options";
import { Strip } from "./src/Strip";
import { threadMenu } from "./src/ThreadMenu";
import "./src/styles.css";

export default definePluginApp((app) => {
  app.experimental_icons.register({ name: DOCK_ICON, component: DockIcon });
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "fixed",
    id: "chat",
    title: "Chat",
    icon: "MessageSquare",
    tooltip: "Chat: the composer, docked here",
    layout: "flush",
    component: Dock,
    useVisible: () => {
      const { ready, enabled, locked } = useOptions();
      return ready && enabled && !locked;
    },
  });
  app.slots.experimental_appOverlay({ id: "strip", component: Strip });
  app.slots.experimental_appOverlay({ id: "return", component: Return });
  // The button is in the composer's own action row, so it is wherever the composer is.
  app.composer.customize({ id: "dock", scopes: ["thread"], actions: [{ id: "menu", component: DockButton }] });
  app.slots.experimental_threadAction(threadMenu);
});
