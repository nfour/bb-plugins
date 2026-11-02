// bb-plugin-lexicon — frontend entry.
//
// A content script, nothing rendered. It paints the project's terms over the
// thread timeline with the CSS Custom Highlight API (src/paint.ts); a null
// overlay (src/Loader.tsx) hands it the lexicon and the setting.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { Loader } from "./src/Loader";
import { install } from "./src/paint";
import { Settings } from "./src/Settings";
import { threadMenu } from "./src/ThreadMenu";
import "./src/styles.css";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "loader", component: Loader });
  app.slots.experimental_threadAction(threadMenu);
  app.slots.settingsSection({ id: "review", title: "Terms", description: "What agents added, what waits for your approval, and what went stale.", component: Settings });
  app.contentScripts.register({
    id: "paint",
    mount({ signal }) {
      return install(signal);
    },
  });
});
