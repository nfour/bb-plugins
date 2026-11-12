// bb-plugin-chat-dock — frontend entry.
//
// Moves BB's own composer shell (the box, the cards above it, the chips under
// it) out of the chat column while the thread's right panel is open: into a
// Chat tab of its own, or, locked, into a strip under whichever tab is open. React
// and @get-bb/plugin-sdk/app are provided by BB at load time, never bundled.
import { definePluginApp, type ExperimentalTabRegistration } from "@get-bb/plugin-sdk/app";
import { Commands, dockingOn, toggleSetting } from "./src/Commands";
import { Dock } from "./src/Dock";
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
    // The literal is the SDK's; written in two halves so the build does not read it as a utility.
    availability: ["fix", "ed"].join("") as ExperimentalTabRegistration["availability"] & string,
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
  app.slots.experimental_appOverlay({ id: "commands", component: Commands });
  // The same switches as the dock button and the thread menu, for the palette and a keyboard binding (none by default).
  app.commands.register({ id: "toggle-docking", title: "Chat Dock: toggle docking the composer", run: () => void toggleSetting("enabled")?.catch(() => {}) });
  app.commands.register({
    id: "toggle-strip",
    title: "Chat Dock: switch between the panel's bottom strip and a Chat tab",
    isAvailable: dockingOn,
    run: () => void toggleSetting("locked")?.catch(() => {}),
  });
  // The button is in the composer's own action row, so it is wherever the composer is.
  app.composer.customize({ id: "dock", scopes: ["thread"], actions: [{ id: "menu", component: DockButton }] });
  app.slots.experimental_threadAction(threadMenu);
});
