# Changelog

Releases are the tags `guest-view/vX.Y.Z` of https://github.com/nfour/bb-plugins.

## 0.2.0 (2026-11-12)

- A guest's new name stays: a name typed while the page waited for news was sometimes put back to the old one. A second tab in the same browser follows a rename.
- One choice, what guests see of each other (only their own prompts, how many guests, or how many and their prompts), replaces two switches.
- Typing in the settings overlay is no longer interrupted when a guest joins or a prompt arrives.
- Less work on your machine while a shared thread is watched: it reads only what changed in the thread.
- The card's clock stops while the browser tab is in the background.

## 0.1.0 (2026-11-06)

- First release. **Share with guest** in a thread's menu (with the other plugins' entries) copies a public link to that thread, made with a Cloudflare quick tunnel (no account). A guest with no BB account follows the conversation live in their browser and can suggest prompts. The link works for 4 hours (1 to 168 with the `expiryHours` setting) or until you stop sharing.
- **What a guest sees:** a page laid out like BB's own thread. They pick a name (a suggested one is kept), then read your messages and the agent's replies as they arrive, with Markdown and code, and a "Working..." line while the agent runs. Tool work shows as counts only ("Ran 3 commands, edited 2 files"), never commands, paths or output. The model and effort are not shown unless you turn on **Show guests the model**. Common secrets are replaced with `[hidden]`. Guests change nothing: no settings, approvals, files or terminal.
- **Suggesting prompts:** guests type in a composer (Enter sends, Shift+Enter adds a line). Their text is plain text only: printable ASCII and line breaks, so emoji, accents, other alphabets and zero-width characters are dropped. A guest sees a grey tick on each prompt they sent and an "N sent" list above the composer, but never what you did with it. Nothing a guest writes reaches the agent unless you put it in your composer.
- **The card above the composer** is one row in the shape of BB's git row: the Guest View icon (two people over a chain link), the guest count, a timer like "3m44s of 4h", a yellow "N pending", and buttons to copy the link, open settings and stop sharing. Click it to open **Prompt Approval**: each prompt with **Use** (puts it in your composer; its menu offers **Use with the name**, `Lydia says: ...`), **Copy** and **Dismiss**. A collapsed **History** keeps what you used or dismissed. A push notification tells you about new prompts (one at once, then a summary every 30 seconds).
- **Settings** (the card's sliders icon): who is connected, with **Kick**; when this link expires; whether guests who join later see earlier messages; whether guests know about each other (the count, and each other's prompts); and whether they see the model.
- **Safe by default:** guest names cannot pass as Owner, System, BB, Claude and the like, or hold a colon or "says"; the card marks a prompt as "(guest) suggests". A page, an address and a share each hold only a few waiting requests, so one guest cannot crowd out the rest. The plugin's log never holds a guest link. A share started any other way than the menu or the card (the `bb` CLI, an agent, another plugin) is logged as a warning and sent to you as a push notification.
- **When things go wrong:** a guest whose connection drops keeps trying and has a "Try now" button; only an ended link or a removal stops the page. After a reload or crash the card says the link ended, and a leftover `cloudflared` is stopped. If the link cannot be copied after sharing, the menu says so.
- **cloudflared:** when it is missing, the card shows how to install it. On Linux, **Install it for me** downloads one pinned release into `~/.local/bin` and installs nothing unless its SHA-256 matches.
