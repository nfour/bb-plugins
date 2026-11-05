# Chat Dock

A BB plugin. While a thread's right panel is open, it moves the composer, the cards above it (running commands, child threads, questions) and the chips under it out of the chat column and into the panel, so the timeline keeps its width.

![The composer docked at the bottom of the right panel, under the Info tab](https://raw.githubusercontent.com/nfour/bb-plugins/master/docs/screenshots/chat-dock-strip.png)

![The Chat dock submenu in the thread's actions menu](https://raw.githubusercontent.com/nfour/bb-plugins/master/docs/screenshots/chat-dock-menu.png)

The dock button in the composer's action row (beside the microphone) switches docking on and off. The rest is in **Chat dock** in the thread's actions menu (⋯ in the thread header, or a sidebar row's menu), with a check beside each option that is on. Two ways to hold it:

- **Keep it at the panel's bottom** (the default): a strip under whichever tab is open (in the bottom tile when the panel is split), so the composer never goes away while the panel is open. The open tab shrinks to make room; nothing is covered.
- Switched off, it is a fixed **Chat** tab instead. The composer is in the panel while that tab is the active one in its pane, and back in the column otherwise. The tab takes part in the panel's own splitting and dragging.

Switching between the two is a single move; the composer never passes through the chat column on the way, and the dock button never expands the box. Hiding the right panel (Ctrl+J) returns the default layout either way, and opening another thread with the panel open swaps the docked composer for that thread's. On a phone-width screen, where the panel is a drawer over the page, the composer docks at the drawer's bottom the same way; BB hides composer actions there, so the dock button is absent; the thread menu still has the options. BB renders that drawer outside the app's React root, where React would ignore the composer's buttons, so in the drawer the composer stays in the app, laid over the drawer's bottom with a spacer of the same height in the drawer, and rises with the drawer above the on-screen keyboard. In a panel narrower than 30rem, where BB would fade the composer's footer (environment, permission mode, context meter) out, the docked composer keeps it showing. Each option is also a plugin setting (`bb plugin config chat-dock`), with a **Debug log** (`bb plugin logs chat-dock`) and **Dock button in the composer**.

Nothing is re-implemented: BB's own elements are moved in the DOM and moved back, which is undocumented; the selectors are in `src/dom.ts` and the repo's `AGENTS.md`.
