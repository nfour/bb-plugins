# Chat Dock

A BB plugin. While a thread's right panel is open, it moves the composer, the cards above it (running commands, child threads, questions) and the chips under it out of the chat column and into the panel, so the timeline keeps its width.

![The composer docked at the bottom of the right panel, under the Info tab](https://raw.githubusercontent.com/nfour/bb-plugins/master/docs/screenshots/chat-dock-strip.png)

![The Chat dock submenu in the thread's actions menu](https://raw.githubusercontent.com/nfour/bb-plugins/master/docs/screenshots/chat-dock-menu.png)

The dock button in the composer's action row (beside the microphone) switches docking on and off. The rest is in **Chat dock** in the thread's actions menu (⋯ in the thread header, or a sidebar row's menu), with a check beside each option that is on. Two ways to hold it:

- **Keep it at the panel's bottom** (the default): a strip under whichever tab is open (in the bottom tile when the panel is split), so the composer never goes away while the panel is open. The open tab shrinks to make room; nothing is covered.
- Switched off, it is a **Chat** tab of its own instead. The composer is in the panel while that tab is the active one in its pane, and back in the column otherwise. The tab takes part in the panel's own splitting and dragging.

Switching between the two is a single move; the composer never passes through the chat column on the way, and the dock button never expands the box. Hiding the right panel (Ctrl+J) returns the default layout either way, and opening another thread with the panel open swaps the docked composer for that thread's. On a phone-width screen, where the panel is a drawer over the page, the composer docks at the drawer's bottom the same way and behaves as it does under the timeline: a tap expands it and shows its footer, every button works, and it rises with the drawer above the on-screen keyboard. BB shows composer actions there only while the box is expanded, so that is when the dock button appears. In the side panel, which is usually narrow, the composer's footer (environment, permission mode, context meter) stays shown without expanding the box. In a split workspace the panel belongs to the focused pane, and that pane's composer docks into it; the other pane's stays under its timeline. Two commands in BB's command palette, **Chat Dock: toggle docking the composer** and **Chat Dock: switch between the panel's bottom strip and a Chat tab**, do what the dock button and the thread menu do, and can be given a key in BB's shortcut settings. Each option is also a plugin setting (`bb plugin config chat-dock`), with a **Debug log** (`bb plugin logs chat-dock`) and **Dock button in the composer**.

Nothing is re-implemented: BB's own elements are moved in the DOM and moved back, which is undocumented; the selectors are in `src/dom.ts`, the phone drawer's overlay in `src/overlay.ts`, and both in the repo's `AGENTS.md`.
