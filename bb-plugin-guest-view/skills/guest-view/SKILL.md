---
name: guest-view
description: Explain, configure or debug the Guest View plugin, which shares one BB thread with someone who has no BB account through a public Cloudflare quick tunnel link. Use when the user asks how to share a thread with a guest, why a guest link does not work, what a guest can see, how guest prompts are approved, or how to install cloudflared for it.
---

# Guest View

**Share with guest** in a thread's menu (⋯) starts a small server on `127.0.0.1` and a Cloudflare quick tunnel to it, and copies a link like `https://<words>.trycloudflare.com/<token>`. One link per thread; it works for `expiryHours` (default 4) or until **Stop sharing** (the card above the composer, or **Guest view** in the thread menu), the plugin stopping, the thread being archived or deleted, or the tunnel dropping.

## What the guest gets

Your messages and the agent's replies (secrets masked as `[hidden]`, best effort), tool work as counts only ("Ran 3 commands, edited 2 files"), whether the agent is working (the model and effort only when the owner allows it in Settings). Nothing else: no tool details, reasoning, files, terminal, diffs or settings. Prompts they suggest (plain printable ASCII only) wait in the card above the owner's composer behind a "N pending" at the end of its row; used and dismissed ones go to a History at the top of the opened card: **Use** puts the text in the composer (no prefix; nothing is sent to the agent directly), **Copy** copies it, **Dismiss** (icon only) drops it. The guest only ever sees that their prompt was sent, never what the owner did.

## Troubleshooting

- **"Guest View needs cloudflared"**: install it with the command on the card, or **Install it for me** on Linux (downloads the pinned cloudflared release 2026.10.7 from GitHub, verifies its SHA-256 and only then installs it as `~/.local/bin/cloudflared`; a mismatch is refused), then share again. `cloudflaredPath` points at another binary.
- **The link shows a Cloudflare 1016, 1033 or 530 page** (1016 reads "Origin DNS error", and its "try again in a few minutes" does not apply): the tunnel has stopped (the share ended or BB restarted). Share again for a new link.
- **The guest page says it ended**: the owner stopped sharing, the link expired, or the owner removed that guest. A page that merely cannot reach the owner ("Cannot reach the owner right now. Still trying...", or a "busy" message) keeps retrying with longer pauses and has a **Try now** button; it never ends by itself.
- **"Too many pages are open from your connection"**: five pages per address can watch one share; close some and the page connects on its next try.
- **The card says "The guest link ended because Guest View was restarted or reloaded"**: the plugin was reloaded or crashed, and links live only in memory and on that run's tunnel. Share again.
- **A push notification "A guest link was started"**: a share was started without the thread menu or the card (the `bb` CLI, an agent that ran a command, another plugin). BB cannot tell those from the owner, so it is reported rather than blocked. Stop it from the card if it was not you.
- Logs: `bb plugin logs guest-view` (each share, tunnel start and stop, and each prompt's arrival and Use or Dismiss; cloudflared's own lines at debug, with guest tokens and queries cut out so the log never holds a working link).
- Owner state from the CLI: `bb plugin rpc call guest-view state --input-file <file with {"threadId": "..."}> --json`.

## Settings

`bb plugin config guest-view`: `expiryHours` (1 to 168, default 4) and `cloudflaredPath` (empty looks in `PATH`, `~/.local/bin`, `~/bin`, `/usr/local/bin`, `/usr/bin`, `/opt/homebrew/bin`).
