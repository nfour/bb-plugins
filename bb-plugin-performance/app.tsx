// bb-plugin-performance — frontend entry.
//
// A content script measures (src/collector.ts); a null overlay hands it the
// saved settings and the RPC (src/Loader.tsx); a nav panel shows the numbers.
// React and @get-bb/plugin-sdk/app are provided by BB at load time, never bundled.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { collector } from "./src/collector";
import { Loader } from "./src/Loader";
import Panel, { HeaderActions, useBadge } from "./src/Panel";
import { threadMenu } from "./src/ThreadMenu";
import "./src/styles.css";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "loader", component: Loader });
  app.contentScripts.register({ id: "collector", mount: ({ signal }) => collector.mount(signal) });
  app.slots.navPanel({
    id: "performance",
    title: "Performance",
    icon: "TimeSchedule",
    path: "performance",
    component: Panel,
    headerContent: HeaderActions,
    experimental_useBadge: useBadge,
  });
  app.slots.experimental_threadAction(threadMenu);
});
