import { experimental_copyToClipboard as copyToClipboard, experimental_THREAD_ACTION_GROUPS as GROUPS, type PluginThreadActionRegistration } from "@get-bb/plugin-sdk/app";
import { SHARE_ICON } from "./Icons";
import { useShared, type Rpc, type SharedThread } from "./state";

interface Data {
  shares: Map<string, SharedThread>;
  rpc: Rpc;
}

const COPY = "copy";
const STOP = "stop";

function watching(share: SharedThread): string {
  const viewers = share.viewers === 1 ? "1 guest watching" : `${share.viewers} guests watching`;
  return share.pending ? `${viewers} · ${share.pending} waiting` : viewers;
}

async function startShare(rpc: Rpc, threadId: string) {
  // `via: "app"` tells the backend this was the owner's click; a share started any other way is reported to the owner.
  const state = await rpc.call("share", { threadId, via: "app" }).catch(() => null);
  if (!state?.share) return; // the card above the composer says what went wrong
  // Starting can take many seconds, after which a browser may refuse the copy (no recent click); say so rather than stay quiet.
  if (!(await copyToClipboard({ text: state.share.url }))) throw new Error("The guest link is ready but could not be copied. Use the link button on the card above the composer.");
}

/** "Share with guest" in the thread's menu; once shared, a submenu to copy the link or stop. */
export const shareAction: PluginThreadActionRegistration<Data> = {
  id: "share",
  title: "Share with guest",
  icon: SHARE_ICON,
  // With the other plugins' entries (Pinned turns 100, Chat dock 101, Lexicon and Performance 102), after them.
  group: GROUPS.settings,
  order: 103,
  useData: useShared,
  item: ({ thread, data }) => {
    const share = data.shares.get(thread.id);
    if (!share) {
      return {
        label: "Share with guest",
        detail: "Copies a public read-only link",
        icon: SHARE_ICON,
        run: () => startShare(data.rpc, thread.id),
      };
    }
    return {
      label: "Guest view",
      detail: watching(share),
      icon: SHARE_ICON,
      choices: {
        items: [
          { id: COPY, label: "Copy guest link", icon: "Copy" },
          { id: STOP, label: "Stop sharing", icon: "CircleX" },
        ],
      },
      run: async ({ value }) => {
        if (value === COPY) await copyToClipboard({ text: share.url });
        else if (value === STOP) await data.rpc.call("stop", { threadId: thread.id }).catch(() => {});
      },
    };
  },
};
