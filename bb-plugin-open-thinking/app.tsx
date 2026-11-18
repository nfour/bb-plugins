// bb-plugin-open-thinking — frontend entry.
//
// An app overlay (React) that renders nothing: while the setting is on it runs one controller that
// watches the page for thinking blocks. React and @get-bb/plugin-sdk/app are provided by BB at load
// time, never bundled.
import { useEffect } from "react";
import { definePluginApp, useSdk } from "@get-bb/plugin-sdk/app";
import { startController } from "./src/controller";
import { useOptions } from "./src/options";
import { threadMenu } from "./src/ThreadMenu";

function Overlay() {
  const sdk = useSdk();
  const { ready, autoExpand, closeOnNew, closeOnFinish, keepLatest, followGrowth } = useOptions();
  useEffect(() => {
    // Not before the saved settings are known, and nothing at all while the option is off.
    if (!ready || !autoExpand) return;
    return startController(sdk, { autoExpand, closeOnNew, closeOnFinish, keepLatest, followGrowth });
  }, [sdk, ready, autoExpand, closeOnNew, closeOnFinish, keepLatest, followGrowth]);
  return null;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "open-thinking", component: Overlay });
  app.slots.experimental_threadAction(threadMenu);
});
