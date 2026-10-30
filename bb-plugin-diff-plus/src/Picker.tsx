// Diff Plus's part of BB's scope picker (the "All changes" menu): its items in
// the order All, Uncommitted, Committed, then the commits under a heading, and
// the recent commits BB does not list.
//
// BB lists only the commits since the merge base and drops a picked commit that
// is not among them, so a recent commit cannot simply be picked. Ours move the
// merge base back (server.ts `show_recent`), wait for BB to list the commit, and
// click BB's own item for it, so BB shows it as it shows any commit. Picking any
// other scope puts the base back (TabTree), so All changes keeps its meaning.
//
// The menu belongs to BB's React tree. Its items are only given a CSS `order`
// (the menu is made a flex column), and ours are a portal appended to it, so
// nothing of BB's is moved. Ours are outside Radix's item collection, so the
// arrow keys skip them.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { pickerItems, pickerMenu, type DiffTab, type PickerItem } from "./diff-tab";
import type { RecentCommit } from "./recent";

const ORDER: Record<Exclude<PickerItem["kind"], "commit">, number> = { all: 1, uncommitted: 2, committed: 3 };
const HEADING_ORDER = 4;
const NOTE_ORDER = 5;
/** Recent commits from here, newest first; other commits BB lists go after them. */
const COMMIT_ORDER = 10;
const OTHER_ORDER = 1000;
/** How long to wait for BB to list a commit after the base moved. */
const LIST_WAIT_MS = 8000;

/**
 * The environments whose merge base a recent commit moved, as far as this page
 * knows. Their "Committed changes" would mean those N commits, and picking it
 * puts the base back, after which BB drops it for All changes, so it is hidden.
 */
const moved = new Set<string>();
export const baseRestored = (environmentId: string) => moved.delete(environmentId);

/** Orders the menu's items; returns the recent commits BB lists itself and whether it lists any commit. */
function arrange(menu: HTMLElement, recent: readonly string[], hideCommitted: boolean): { listed: Set<string>; commits: boolean } {
  menu.setAttribute("data-diff-plus-picker", "");
  const listed = new Set<string>();
  let commits = false;
  let other = 0;
  for (const item of pickerItems(menu)) {
    let order: number;
    if (item.kind !== "commit") order = ORDER[item.kind];
    else {
      commits = true;
      const index = item.sha ? recent.findIndex((sha) => sha.startsWith(item.sha!)) : -1;
      if (index >= 0) listed.add(recent[index]!);
      order = index >= 0 ? COMMIT_ORDER + index : OTHER_ORDER + other++;
    }
    item.element.style.order = String(order);
    if (item.kind === "committed") item.element.style.display = hideCommitted ? "none" : "";
  }
  return { listed, commits };
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((value) => b.has(value));

export interface PickerProps {
  tab: DiffTab;
  environmentId: string | null;
  /** The recent commits, newest first; empty when the option is off. */
  commits: readonly RecentCommit[];
  count: number;
}

export function PickerCommits({ tab, environmentId, commits, count }: PickerProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [listed, setListed] = useState<ReadonlySet<string>>(new Set());
  const [bbCommits, setBbCommits] = useState(false);
  const [pending, setPending] = useState<{ sha: string; error: string | null } | null>(null);
  const shas = useMemo(() => commits.map((commit) => commit.sha), [commits]);
  const shasRef = useRef(shas);
  shasRef.current = shas;
  const menuRef = useRef<HTMLElement | null>(null);
  const environmentRef = useRef(environmentId);
  environmentRef.current = environmentId;
  const hideCommitted = () => environmentRef.current !== null && moved.has(environmentRef.current);

  // Follows the picker opening and closing (the button's data-state) and BB
  // changing its items, ordering them in the same task, before a paint.
  useEffect(() => {
    let items: MutationObserver | null = null;
    const order = () => {
      const menu = menuRef.current;
      if (!menu) return;
      const result = arrange(menu, shasRef.current, hideCommitted());
      setListed((previous) => (sameSet(previous, result.listed) ? previous : result.listed));
      setBbCommits(result.commits);
    };
    const look = () => {
      const next = pickerMenu(tab);
      if (next !== menuRef.current) {
        items?.disconnect();
        items = null;
        menuRef.current = next;
        setMenu(next);
        setPending(null);
        if (next) {
          items = new MutationObserver(order);
          items.observe(next, { childList: true });
        }
      }
      order();
    };
    const trigger = new MutationObserver(look);
    trigger.observe(tab.toolbar, { attributes: true, attributeFilter: ["data-state"], subtree: true });
    look();
    return () => {
      trigger.disconnect();
      items?.disconnect();
    };
  }, [tab]);
  // The recent commits changed under an open menu.
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const result = arrange(menu, shas, hideCommitted());
    setListed((previous) => (sameSet(previous, result.listed) ? previous : result.listed));
  }, [shas]);

  if (!menu) return null;

  const show = async (commit: RecentCommit) => {
    if (!environmentId || pending?.error === null) return;
    setPending({ sha: commit.sha, error: null });
    // The commit will not be picked: put the base back.
    const abandon = () =>
      rpc
        .call("restore_base", { environmentId, reason: "abandoned" })
        .then((result) => result.ok && baseRestored(environmentId))
        .catch(() => {});
    try {
      const result = await rpc.call("show_recent", { environmentId, count });
      if (!result.ok) throw new Error(result.message);
      if (result.moved) moved.add(environmentId);
      const deadline = Date.now() + LIST_WAIT_MS;
      while (menuRef.current === menu && menu.isConnected) {
        const item = pickerItems(menu).find((item) => item.kind === "commit" && item.sha && commit.sha.startsWith(item.sha));
        if (item) return item.element.click();
        if (Date.now() > deadline) throw new Error("BB did not list the commit in time.");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await abandon();
    } catch (cause) {
      await abandon();
      if (menuRef.current === menu) setPending({ sha: commit.sha, error: cause instanceof Error ? cause.message : String(cause) });
    }
  };

  const missing = commits.map((commit, index) => ({ commit, index })).filter(({ commit }) => !listed.has(commit.sha));
  if (!commits.length && !bbCommits) return null;
  return createPortal(
    <>
      <div className="diff-plus-picker-heading" style={{ order: HEADING_ORDER }} role="presentation">
        {commits.length ? "Recent commits" : "Commits"}
      </div>
      {pending?.error && (
        <div className="diff-plus-picker-note" style={{ order: NOTE_ORDER }} role="alert">
          {pending.error}
        </div>
      )}
      {missing.map(({ commit, index }) => (
        <div
          key={commit.sha}
          role="menuitem"
          tabIndex={-1}
          data-diff-plus-row=""
          data-busy={(pending?.sha === commit.sha && pending.error === null) || undefined}
          className="diff-plus-picker-row"
          style={{ order: COMMIT_ORDER + index }}
          title={`${commit.shortSha} ${commit.subject}`}
          onClick={() => void show(commit)}
        >
          <span className="diff-plus-picker-sha">{commit.shortSha}</span>
          <span className="diff-plus-picker-subject">{commit.subject}</span>
        </div>
      ))}
    </>,
    menu,
  );
}
