## What you get

While you scroll a thread, a bar stays pinned to the top of the timeline. The right half shows the message you are reading under, and the left half shows the latest agent reply above that point. Click either half to scroll to that message, which lands just below the bar. Blank halves fade out when there is nothing above them. Each pane of a split workspace has its own bar, and you can show only the message half or only the reply half.

Long threads stay oriented: you always see which question you are in the middle of and what the agent last answered, without scrolling back up to check. While a turn runs, your message and its reply pulse; a dot marks a turn that failed or was interrupted; a counter such as `7/23` shows which turn you are on (not on a thread view under 840px wide); hovering a cut-short message shows it in full.

The options are in **Pinned turns** in a thread's actions menu; the README lists them.

## Requirements

- BB 0.48 or later.
- It reads BB's timeline layout, which is not a documented interface, so a future BB release may need a plugin update.
- Jumping never changes the page URL or the back button's history.
- While a turn works it fetches only what changed in the timeline (about 1 KB), and nothing while the bar is off the page or the tab is in the background.
- No external service or account is used.
