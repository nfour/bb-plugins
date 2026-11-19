// bb-plugin-reply-style — frontend entry.
//
// The reply styling is src/styles.css. BB keeps a plugin's stylesheet on the page only while one of
// its slots is mounted or a content script is registered, so an empty content script holds it there.
// A null overlay mirrors the settings onto <html>: attributes for the switches and custom properties
// for the numbers, each written only while it differs from its default (with every default the page
// carries nothing). While a slider in the settings panel is dragged, its value is applied over the
// saved one. The panel opens from the thread's actions menu and is also a section of BB's settings page.
import { useEffect } from "react";
import { definePluginApp, useSettings } from "@get-bb/plugin-sdk/app";
import { Panel, SettingsPage } from "./src/Panel";
import { usePreview } from "./src/preview";
import { attributesFor, propertiesFor } from "./src/shared";
import { threadMenu } from "./src/ThreadMenu";
import "./src/styles.css";
import "./src/panel.css";

function Options() {
  const { values } = useSettings();
  const preview = usePreview();
  useEffect(() => {
    const merged = { ...(values ?? {}), ...preview } as Record<string, unknown>;
    const root = document.documentElement;
    const attrs = attributesFor(merged);
    const props = propertiesFor(merged);
    for (const [name, value] of Object.entries(attrs)) {
      if (value === null) root.removeAttribute(name);
      else root.setAttribute(name, value);
    }
    for (const [name, value] of Object.entries(props)) {
      if (value === null) root.style.removeProperty(name);
      else root.style.setProperty(name, value);
    }
  }, [values, preview]);
  // Everything comes off <html> when the plugin is unloaded or turned off.
  useEffect(
    () => () => {
      const root = document.documentElement;
      for (const name of Object.keys(attributesFor({}))) root.removeAttribute(name);
      for (const name of Object.keys(propertiesFor({}))) root.style.removeProperty(name);
    },
    [],
  );
  const limit = Boolean(({ ...(values ?? {}), ...preview } as Record<string, unknown>).limit);
  useEffect(() => (limit ? watchScrollbar() : undefined), [limit]);
  return <Panel />;
}

/** While Height Limit is on, keeps --reply-style-scrollbar on <html> at the page's scrollbar width
 * (BB sets thin scrollbars; overlay scrollbars measure 0), so styles.css can hang a capped spoiler's
 * scrollbar outside its text. Measured again when the window changes size, since zoom changes it. */
// The window event's name, joined so the build's utility scan does not read it as a class.
const SIZE = ["res", "ize"].join("");

function watchScrollbar(): () => void {
  const root = document.documentElement;
  const measure = () => {
    const probe = document.createElement("div");
    probe.style.cssText = "width:100px;height:50px;overflow-y:scroll;visibility:hidden;margin-top:-50px";
    const home = document.querySelector("[data-markdown-preview]") ?? document.body;
    home.appendChild(probe);
    root.style.setProperty("--reply-style-scrollbar", `${probe.offsetWidth - probe.clientWidth}px`);
    probe.remove();
  };
  measure();
  window.addEventListener(SIZE, measure);
  return () => {
    window.removeEventListener(SIZE, measure);
    root.style.removeProperty("--reply-style-scrollbar");
  };
}

export default definePluginApp((app) => {
  app.contentScripts.register({ id: "stylesheet", mount: () => undefined });
  app.slots.experimental_appOverlay({ id: "options", component: Options });
  app.slots.experimental_threadAction(threadMenu);
  app.slots.settingsSection({ id: "reply-style", title: "Reply Style", description: "Quotes, spoilers, lists and tables in thread replies.", component: SettingsPage });
});
