# Pinned Turns

A BB plugin. While you scroll a thread's timeline it pins a bar at the top showing the user message you are reading under and the latest agent reply. Click either half to jump to that message.

![The bar pinned at the top of a long thread, naming the reply and the question, with the turn counter](https://raw.githubusercontent.com/nfour/bb-plugins/master/docs/screenshots/pinned-turns-bar.png)

![The Pinned turns submenu in the thread's actions menu](https://raw.githubusercontent.com/nfour/bb-plugins/master/docs/screenshots/pinned-turns-menu.png)

Open the thread's actions menu (⋯ in the thread header, or a sidebar row's menu) and point at **Pinned turns** for its options; a check marks the ones that are on:

- **Pin the current turn**: the on/off switch.
- **Message and reply / Message only / Reply only**: which halves of the bar are drawn (the counter belongs to the message half).
- **Turn status**: your message and the reply pulse while the turn runs; a dot marks one that failed or was interrupted.
- **Turn counter**: `7/23` just outside your message's right edge, the first number semibold (counted from BB's `conversationOutline`, one small request; left out when the thread view is under 840px wide, where it would be clipped).
- **Full text on hover**: a tooltip when the bar cut a message short.
- **Debug log**: timing lines in the plugin log (`bb plugin logs pinned-turns`).
- **Plugin settings**: opens that page.

Each is also a plugin setting (`halves` is `both`, `message` or `reply`). Every pane of a split workspace has its own bar. The submenu itself can be removed from the plugin's page in BB settings (**Show in thread menus**). Options that cannot apply here are greyed out, with the reason below the list.

It reads BB's timeline DOM, which is undocumented; the selectors it relies on are in `src/dom.ts` and the repo's `AGENTS.md`.

On a narrow thread view or a touch-only device, options that cannot apply (the turn counter, full text on hover) are greyed out in the menu.
