import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { GuestCard } from "./src/Card";
import { SHARE_ICON, ShareIcon } from "./src/Icons";
import { shareAction } from "./src/ThreadMenu";
import "./src/styles.css";

export default definePluginApp((app) => {
  // A registered name works wherever BB takes an icon name; the thread menu takes only names, not components.
  app.experimental_icons.register({ name: SHARE_ICON, component: ShareIcon });
  app.slots.experimental_threadAction(shareAction);
  app.composer.customize({ id: "guest-prompts", scopes: ["thread"], banners: [{ id: "guest-prompts", chrome: "bare", component: GuestCard }] });
});
