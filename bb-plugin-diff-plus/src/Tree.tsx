// The folder tree beside BB's Diff tab.
//
// `TreeOverlay` is an app overlay: it finds each Diff tab on the page
// (src/diff-tab.ts) and, for each, portals a toggle into the tab's toolbar and,
// while the tree is on, a column into the box around its file list. A click on a
// folder types `folder/**` into BB's own filter box; a click on a file types its
// path and opens its card. The list, its diffs and its filtering stay BB's.
//
// The files come from the Git plugin's `files` read (through server.ts) for the scope the tab shows,
// fetched only while a tree is on, and again when the environment's git state
// changes. Nothing here reads the composer, so typing never re-renders the tree.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { experimental_Icon as Icon, useBbContext, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import {
  expandFile,
  filterValue,
  findDiffTabs,
  filtersKey,
  isFilterInput,
  listScroller,
  paneThread,
  readFilters,
  readListPlace,
  restoreListPlace,
  scopeLabel,
  scrollListToTop,
  setFilter,
  VIEWED_BOX,
  watchDiffTabs,
  watchVisibleCards,
  type DiffTab,
  type ListPlace,
} from "./diff-tab";
import {
  allDirs,
  ancestors,
  applyFilters,
  buildTree,
  dirName,
  fileName,
  filePattern,
  folderPattern,
  listFiles,
  openAt,
  scopeOf,
  selectedBy,
  statusOf,
  type DiffFilters,
  type Scope,
  type TreeDir,
  type TreeFile,
} from "./folders";
import { fileIcon, folderIcon } from "./file-icons";
import { filterMatches } from "./match";
import { setOption, useOptions } from "./options";
import { baseRestored, PickerCommits } from "./Picker";
import { useRecentCommits } from "./recent";
import { TreeMenu, ViewMenu } from "./TreeMenu";

/** Environment changes that can change which files differ. */
const REFRESH_ON = new Set(["status-changed", "git-refs-changed", "metadata-changed"]);
/** Quiet time after a git change before the files are fetched again; agents write in bursts. */
const REFRESH_WAIT_MS = 1000;
/** A failed fetch is tried again after this long. */
const RETRY_MS = 3000;
/** Under this width the tree goes above the file list instead of beside it. */
const STACK_BELOW = 600;

// ---------------------------------------------------------------------------
// Where the reader was, per thread and scope, for the rest of the page's life.
// BB unmounts the Diff tab when another tab is shown (opening a file from a
// card's title does that), which drops its filter and scroll; when the tab comes
// back, the tree puts back the folders it had open, the row picked (through
// BB's filter box), its own scroll and the file list's place.

interface Place {
  paths: Set<string> | null;
  filter: string;
  treeScroll: number;
  list: ListPlace | null;
}

/** A folder path and every folder above it: "a/b/c" → "a", "a/b", "a/b/c". */
const withParents = (path: string) => path.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/"));

const places = new Map<string, Place>();
const placeOf = (key: string): Place => {
  let place = places.get(key);
  if (!place) places.set(key, (place = { paths: null, filter: "", treeScroll: 0, list: null }));
  return place;
};

// The tree's width, once the reader has dragged its edge; until then the
// stylesheet's default. Room is always left for the file list beside it. It is
// a custom property so the stacked layout can ignore it.
const WIDTH_KEY = "bb-plugin-diff-plus:tree-width";
const WIDTH_VAR = "--diff-plus-tree-width";
const MIN_WIDTH = 140;
const LIST_ROOM = 240;
const RESIZE_STEP = 16;
const clampWidth = (width: number, list: HTMLElement) => Math.round(Math.max(MIN_WIDTH, Math.min(width, list.clientWidth - LIST_ROOM)));
const storedWidth = () => Number(localStorage.getItem(WIDTH_KEY)) || null;

// ---------------------------------------------------------------------------
// The Diff tabs on the page.

interface TabState {
  tab: DiffTab;
  label: string;
  filter: string;
  /** The tab's "Filter files" choices, which the tree follows. */
  filters: DiffFilters | null;
  thread: string | null;
}

const ids = new WeakMap<Element, number>();
let nextId = 1;
const idOf = (element: Element) => {
  let id = ids.get(element);
  if (!id) ids.set(element, (id = nextId++));
  return id;
};

const sameTab = (a: TabState, b: TabState) =>
  a.tab.list === b.tab.list &&
  a.tab.actions === b.tab.actions &&
  a.tab.toolbar === b.tab.toolbar &&
  a.label === b.label &&
  a.filter === b.filter &&
  a.thread === b.thread &&
  filtersKey(a.filters) === filtersKey(b.filters);

function useDiffTabs(fallbackThread: string | null): TabState[] {
  const [tabs, setTabs] = useState<TabState[]>([]);
  useEffect(() => {
    let frame = 0;
    let current: TabState[] = [];
    const check = () => {
      frame = 0;
      const next = findDiffTabs().map((tab) => ({
        tab,
        label: scopeLabel(tab),
        filter: filterValue(tab),
        filters: readFilters(tab),
        thread: paneThread(tab) ?? fallbackThread,
      }));
      if (next.length === current.length && next.every((state, i) => sameTab(state, current[i]!))) return;
      current = next;
      setTabs(next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    const stop = watchDiffTabs(schedule, () => current.map((state) => state.tab.list));
    // Typing in BB's filter box changes its value without touching the DOM.
    const typed = (event: Event) => isFilterInput(event.target) && schedule();
    document.addEventListener("input", typed, true);
    check();
    return () => {
      stop();
      document.removeEventListener("input", typed, true);
      cancelAnimationFrame(frame);
    };
  }, [fallbackThread]);
  return tabs;
}

export function TreeOverlay() {
  const { threadId } = useBbContext();
  const tabs = useDiffTabs(threadId);
  return (
    <>
      {tabs.map((state) => (
        <TabTree key={idOf(state.tab.list)} {...state} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// One tab: the toggle in its toolbar and, while on, the column.

/** An element of ours put first in `parent` for as long as the component is mounted. */
function useHost(parent: HTMLElement | null, className: string) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!parent) return;
    const element = document.createElement("div");
    element.className = className;
    parent.prepend(element);
    setHost(element);
    return () => {
      element.remove();
      setHost(null);
    };
  }, [parent, className]);
  return host;
}

type Layout = "side" | "stacked";

/** Whether the tree fits beside the list, read from the list's width while `list` is given. */
function useLayout(list: HTMLElement | null): Layout {
  const [layout, setLayout] = useState<Layout>("side");
  useLayoutEffect(() => {
    if (!list) return;
    const read = () => setLayout(list.clientWidth < STACK_BELOW ? "stacked" : "side");
    read();
    const observer = new ResizeObserver(read);
    observer.observe(list);
    return () => observer.disconnect();
  }, [list]);
  return layout;
}

/** The thread's environment, read once per thread. */
function useEnvironmentId(threadId: string | null): string | null {
  const sdk = useSdk();
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  useEffect(() => {
    setEnvironmentId(null);
    if (!threadId) return;
    const controller = new AbortController();
    sdk.threads
      .get({ threadId, signal: controller.signal })
      .then((thread) => setEnvironmentId(thread.environmentId ?? null))
      .catch(() => {});
    return () => controller.abort();
  }, [sdk, threadId]);
  return environmentId;
}

function TabTree({ tab, label, filter, filters, thread }: TabState) {
  const options = useOptions();
  const environmentId = useEnvironmentId(thread);
  const rpc = useRpc<typeof rpcContract>();
  const commits = useRecentCommits(environmentId, options.recentCount, options.recent);
  const toggleHost = useHost(tab.actions, "diff-plus-toggle-host");
  const columnHost = useHost(options.open ? tab.list : null, "diff-plus-tree");
  const layout = useLayout(columnHost ? tab.list : null);
  // The stylesheet lays the list's box out as a row ("side") or a column ("stacked").
  useLayoutEffect(() => {
    if (!columnHost) return;
    tab.list.setAttribute("data-diff-plus-tree", layout);
    return () => tab.list.removeAttribute("data-diff-plus-tree");
  }, [columnHost, layout, tab.list]);

  const scope = useMemo(() => scopeOf(label), [label]);
  // A recent commit moved the merge base back so BB would show it (Picker.tsx);
  // any other scope puts it back, so All and Committed changes mean what they did.
  const showsCommit = scope?.target === "commit";
  useEffect(() => {
    if (!environmentId || !scope || (showsCommit && options.recent)) return;
    rpc
      .call("restore_base", { environmentId, reason: options.recent ? "scope" : "recent-off" })
      .then((result) => result.ok && baseRestored(environmentId))
      .catch(() => {});
  }, [rpc, environmentId, scope !== null, showsCommit, options.recent]); // scope !== null stands for scope
  const files = useChangedFiles(options.open ? environmentId : null, scope);
  const viewed = useViewed(environmentId, files.status === "ready" ? files.target : null, tab.list, filters?.showViewed === false);
  const filterKey = filtersKey(filters);
  const shown = useMemo(
    () => (files.status === "ready" ? applyFilters(files.files, filters, viewed) : null),
    [files, filterKey, viewed], // filterKey stands for filters
  );
  const tree = useMemo(() => (shown ? buildTree(shown, options.compact, options.synced) : null), [shown, options.compact, options.synced]);
  const key = thread && label ? `${thread}|${label}` : null;

  // Open folders, per scope: what the reader had (see Place), else the chosen
  // depth when the scope's tree first loads; later loads keep the reader's.
  const [open, setOpen] = useState<{ key: string; paths: Set<string> } | null>(null);
  useEffect(() => {
    if (tree && key && open?.key !== key) setOpen({ key, paths: placeOf(key).paths ?? openAt(tree, options.depth) });
  }, [tree, key, open?.key, options.depth]);
  const paths = open && open.key === key ? open.paths : null;
  // A folded row carries its deepest path, so an open "src/foo/bar" opens
  // "src" and "src/foo" too when folding is switched off, or when a filter
  // change unfolds it.
  useEffect(() => {
    setOpen((was) => was && { key: was.key, paths: new Set([...was.paths].flatMap(withParents)) });
  }, [options.compact, filterKey]);
  useEffect(() => {
    if (open) placeOf(open.key).paths = open.paths;
  }, [open]);

  const restoring = useRestorePlace(tab, key, filter);

  return (
    <>
      {toggleHost && createPortal(<TreeMenu />, toggleHost)}
      <PickerCommits tab={tab} environmentId={environmentId} commits={commits} count={options.recentCount} />
      {columnHost &&
        createPortal(
          <>
            <TreeScroll placeKey={key} ready={paths !== null} restoring={restoring}>
              <TreeColumn tab={tab} filter={filter} scope={scope} files={files} tree={tree} shown={shown} paths={paths} setOpen={setOpen} />
            </TreeScroll>
            <ResizeHandle column={columnHost} list={tab.list} />
          </>,
          columnHost,
        )}
    </>
  );
}

/**
 * Puts the reader's place back when a Diff tab mounts (see Place), then keeps it
 * up to date: the filter as it changes, the list's place as it scrolls. Returns
 * whether the restore is still running, during which nothing is saved.
 */
function useRestorePlace(tab: DiffTab, key: string | null, filter: string): boolean {
  const [restoring, setRestoring] = useState(true);
  const started = useRef(false);
  useEffect(() => {
    if (!key || started.current) return;
    started.current = true;
    const place = placeOf(key);
    let cancelled = false;
    const cancel = () => (cancelled = true);
    const input = ["wheel", "pointerdown", "keydown", "touchstart"] as const;
    for (const type of input) tab.list.addEventListener(type, cancel, { capture: true, passive: true });
    void (async () => {
      try {
        if (place.filter && !filterValue(tab)) await setFilter(tab, place.filter);
        if (place.list && !cancelled) await restoreListPlace(tab, place.list, () => cancelled);
      } finally {
        for (const type of input) tab.list.removeEventListener(type, cancel, { capture: true });
        setRestoring(false);
      }
    })();
  }, [key, tab]);

  useEffect(() => {
    if (key && !restoring) placeOf(key).filter = filter;
  }, [key, filter, restoring]);

  useEffect(() => {
    if (!key || restoring) return;
    let frame = 0;
    const save = () => {
      frame = 0;
      const scroller = listScroller(tab);
      if (scroller) placeOf(key).list = readListPlace(scroller);
    };
    // Scroll events do not bubble, but they pass the list's box on the way down.
    const onScroll = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".diff-plus-tree")) return;
      if (!frame) frame = requestAnimationFrame(save);
    };
    tab.list.addEventListener("scroll", onScroll, true);
    return () => {
      tab.list.removeEventListener("scroll", onScroll, true);
      cancelAnimationFrame(frame);
    };
  }, [key, tab, restoring]);
  return restoring;
}

/** The tree's own scroller: put back where it was once the rows are there, and remembered as it moves. */
function TreeScroll({
  placeKey,
  ready,
  restoring,
  children,
}: {
  placeKey: string | null;
  ready: boolean;
  restoring: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const restored = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!ready || !placeKey || !ref.current || restored.current === placeKey) return;
    restored.current = placeKey;
    ref.current.scrollTop = placeOf(placeKey).treeScroll;
  }, [ready, placeKey]);
  return (
    <div
      ref={ref}
      className="diff-plus-tree-scroll"
      onScroll={(event) => {
        if (placeKey && !restoring && restored.current === placeKey) placeOf(placeKey).treeScroll = event.currentTarget.scrollTop;
      }}
    >
      {children}
    </div>
  );
}

/** The column's right edge, beside the list only: drag it, or focus it and use the arrow keys. */
function ResizeHandle({ column, list }: { column: HTMLElement; list: HTMLElement }) {
  useLayoutEffect(() => {
    const width = storedWidth();
    if (width) column.style.setProperty(WIDTH_VAR, `${clampWidth(width, list)}px`);
    else column.style.removeProperty(WIDTH_VAR);
  }, [column, list]);
  const set = (width: number) => {
    const next = clampWidth(width, list);
    column.style.setProperty(WIDTH_VAR, `${next}px`);
    return next;
  };
  return (
    <div
      className="diff-plus-tree-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize folder tree"
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        const start = event.clientX - column.getBoundingClientRect().width;
        let last = column.getBoundingClientRect().width;
        const move = (e: PointerEvent) => (last = set(e.clientX - start));
        const end = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", end);
          handle.removeEventListener("pointercancel", end);
          localStorage.setItem(WIDTH_KEY, String(last));
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", end);
        handle.addEventListener("pointercancel", end);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const width = column.getBoundingClientRect().width;
        localStorage.setItem(WIDTH_KEY, String(set(width + (event.key === "ArrowLeft" ? -RESIZE_STEP : RESIZE_STEP))));
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// The files.

/** What a Diff tab scope compares, in `bb--git`'s terms. */
type DiffTarget = { type: "uncommitted" } | { type: "all" | "branch_committed"; mergeBaseBranch: string } | { type: "commit"; sha: string };

type Files =
  | { status: "loading" }
  | { status: "ready"; files: TreeFile[]; truncated: boolean; target: DiffTarget; for: string }
  | { status: "error"; message: string };

const LOADING: Files = { status: "loading" };

function useChangedFiles(environmentId: string | null, scope: Scope | null): Files {
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  const [files, setFiles] = useState<Files>({ status: "loading" });
  const scopeKey = scope ? JSON.stringify(scope) : null;
  const forKey = `${environmentId}|${scopeKey}`;
  useEffect(() => {
    setFiles({ status: "loading" });
    if (!environmentId || !scope) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | null = null;

    const load = async () => {
      controller?.abort();
      const { signal } = (controller = new AbortController());
      try {
        if (!unsubscribe && !disposed) {
          unsubscribe = sdk.subscribe({
            event: "environment:changed",
            environmentId,
            callback: ({ changes }) => {
              if (!changes.some((change) => REFRESH_ON.has(change))) return;
              clearTimeout(timer);
              timer = setTimeout(load, REFRESH_WAIT_MS);
            },
          });
        }
        const environment = await sdk.environments.get({ environmentId, signal });
        const base = environment.mergeBaseBranch ?? environment.defaultBranch;
        const target: DiffTarget | null =
          scope.target === "all" || scope.target === "branch_committed"
            ? base
              ? { type: scope.target, mergeBaseBranch: base }
              : null
            : scope.target === "commit"
              ? { type: scope.target, sha: scope.sha }
              : { type: scope.target };
        if (!target) throw new Error("This environment has no base branch to compare with.");
        const result = await rpc.call("files", { environmentId, target });
        if (disposed || signal.aborted) return;
        if (result.outcome !== "available") {
          setFiles({ status: "error", message: result.outcome === "unavailable" ? result.failure.message : result.message });
          return;
        }
        setFiles({
          status: "ready",
          for: forKey,
          truncated: result.truncated,
          target,
          files: result.files.map((file) => ({
            path: file.path,
            previousPath: file.previousPath,
            additions: file.additions,
            deletions: file.deletions,
            changeKind: file.changeKind,
            untracked: file.origin === "untracked",
            revision: file.revision,
          })),
        });
      } catch (cause) {
        if (disposed || signal.aborted) return;
        setFiles((previous) =>
          previous.status === "ready" ? previous : { status: "error", message: cause instanceof Error ? cause.message : String(cause) },
        );
        clearTimeout(timer);
        timer = setTimeout(load, RETRY_MS);
      }
    };
    void load();
    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(timer);
      unsubscribe?.();
    };
  }, [sdk, rpc, environmentId, scopeKey]); // scopeKey stands for scope
  // On the render where the scope changes, the state still holds the previous
  // scope's files (the effect clears it after); they must not open its folders.
  return files.status === "ready" && files.for !== forKey ? LOADING : files;
}

/** How long after a Viewed box is ticked to read the marks again, so BB has saved it. */
const VIEWED_WAIT_MS = 800;

/**
 * The files marked Viewed (path to the revision marked), read only while the
 * filter hides viewed files; null until known.
 */
function useViewed(environmentId: string | null, target: DiffTarget | null, list: HTMLElement, enabled: boolean) {
  const rpc = useRpc<typeof rpcContract>();
  const [viewed, setViewed] = useState<ReadonlyMap<string, string> | null>(null);
  const targetKey = target ? JSON.stringify(target) : null;
  useEffect(() => {
    setViewed(null);
    if (!enabled || !environmentId || !target) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      rpc
        .call("viewed", { environmentId, target })
        .then((result) => !disposed && setViewed(new Map(result.files.map((file) => [file.path, file.revision]))))
        .catch(() => {});
    const ticked = new MutationObserver((records) => {
      if (!records.some((record) => record.target instanceof Element && record.target.matches(VIEWED_BOX))) return;
      clearTimeout(timer);
      timer = setTimeout(load, VIEWED_WAIT_MS);
    });
    ticked.observe(list, { attributes: true, attributeFilter: ["aria-checked"], subtree: true });
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
      ticked.disconnect();
    };
  }, [rpc, environmentId, targetKey, list, enabled]); // targetKey stands for target
  return viewed;
}

// ---------------------------------------------------------------------------
// The column.

const numbers = new Intl.NumberFormat();

function Stats({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="diff-plus-stats">
      {additions > 0 && <span className="diff-plus-added">+{numbers.format(additions)}</span>}
      {deletions > 0 && <span className="diff-plus-removed">−{numbers.format(deletions)}</span>}
    </span>
  );
}

/** A vscode-icons glyph, drawn by its class in src/icons.css. */
const FileIcon = ({ icon }: { icon: string }) => <span className={`diff-plus-file-icon diff-plus-i-${icon}`} aria-hidden />;

interface RowsProps {
  dir: TreeDir;
  depth: number;
  open: ReadonlySet<string>;
  /** How many levels of open folders stick under "Changes" (see useStuckRows). */
  room: number;
  /** "dir:<path>" or "file:<path>" for the row the filter stands for. */
  active: string | null;
  toggle: (path: string) => void;
  pick: (kind: "dir" | "file", path: string) => void;
  /** What the path filter shows, when it shows less than everything: tinted. */
  lit: Lit | null;
}

/** The files the path filter lets through, and every folder above one of them. */
interface Lit {
  files: ReadonlySet<string>;
  dirs: ReadonlySet<string>;
  /** The folders every file of which the filter lets through: tinted open too, so a band runs through them. */
  whole: ReadonlySet<string>;
}

// 0.5rem at the root: room between the synced-view line on the left edge and the icons.
const indent = (depth: number) => ({ paddingLeft: `${0.5 + depth * 0.75}rem` });

const Rows = memo(function Rows({ dir, depth, open, room, active, toggle, pick, lit }: RowsProps) {
  const fileRow = (file: TreeFile) => {
    const status = statusOf(file);
    return (
      <div
        key={file.path}
        className="diff-plus-row"
        data-active={active === `file:${file.path}` || undefined}
        data-match={lit?.files.has(file.path) || undefined}
        data-path={file.path}
        style={indent(depth)}
      >
        <button
          type="button"
          className="diff-plus-pick"
          role="treeitem"
          aria-selected={active === `file:${file.path}`}
          title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
          onClick={() => pick("file", file.path)}
        >
          <FileIcon icon={fileIcon(file.path)} />
          <span className="diff-plus-name" data-deleted={file.changeKind === "deleted" || undefined}>
            {fileName(file.path)}
          </span>
          <Stats additions={file.additions} deletions={file.deletions} />
          <span className="diff-plus-mark" data-tone={status.tone} title={status.title}>
            {status.mark}
          </span>
        </button>
      </div>
    );
  };
  return (
    <>
      {dir.entries.map((entry) => {
        if (!("dirs" in entry)) return fileRow(entry);
        const child = entry;
        const expanded = open.has(child.path);
        // An open folder's row sticks under "Changes" while its rows are above (and
        // under the rows of the open folders holding it), pushed up by the end of
        // its wrapper, which is its containing block.
        const sticky = expanded && depth < room;
        return (
          <div key={child.path} role="none">
            <div
              className={sticky ? "diff-plus-row diff-plus-sticky" : "diff-plus-row"}
              data-active={active === `dir:${child.path}` || undefined}
              data-match={(expanded ? lit?.whole.has(child.path) : lit?.dirs.has(child.path)) || undefined}
              data-path={child.path}
              style={sticky ? { ...indent(depth), top: PINNED_TOP + depth * ROW_HEIGHT, zIndex: MAX_PINNED - depth } : indent(depth)}
            >
              {/* The folder's icon opens and closes it (no chevrons: the open and closed icons show the state). */}
              <button
                type="button"
                className="diff-plus-twisty"
                // Not "Expand <path>": BB labels its file cards that way, and
                // expandFile looks them up by label.
                aria-label={`${child.path}/`}
                aria-expanded={expanded}
                title={expanded ? "Close folder" : "Open folder"}
                onClick={() => toggle(child.path)}
              >
                <FileIcon icon={folderIcon(child.path, expanded)} />
              </button>
              <button
                type="button"
                className="diff-plus-pick"
                role="treeitem"
                aria-expanded={expanded}
                aria-selected={active === `dir:${child.path}`}
                title={`${child.path}/ · ${child.count} ${child.count === 1 ? "file" : "files"}`}
                onClick={() => pick("dir", child.path)}
              >
                <span className="diff-plus-name">{child.name}</span>
                <span className="diff-plus-count">{child.count}</span>
                <Stats additions={child.additions} deletions={child.deletions} />
                <span className="diff-plus-mark" data-tone={child.tone ?? undefined} aria-hidden>
                  <span className="diff-plus-dot" />
                </span>
              </button>
            </div>
            {expanded && (
              <div role="group">
                <Rows dir={child} depth={depth + 1} open={open} room={room} active={active} toggle={toggle} pick={pick} lit={lit} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
});

/** The list view: every file on its own row, its folder beside its name. */
const FlatRows = memo(function FlatRows({
  files,
  active,
  pick,
  lit,
}: Omit<RowsProps, "dir" | "depth" | "open" | "room" | "toggle"> & { files: readonly TreeFile[] }) {
  return (
    <>
      {files.map((file) => {
        const status = statusOf(file);
        return (
          <div
            key={file.path}
            className="diff-plus-row"
            data-active={active === `file:${file.path}` || undefined}
            data-match={lit?.files.has(file.path) || undefined}
            data-path={file.path}
            style={indent(0)}
          >
            <button
              type="button"
              className="diff-plus-pick"
              role="treeitem"
              aria-selected={active === `file:${file.path}`}
              title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
              onClick={() => pick("file", file.path)}
            >
              <FileIcon icon={fileIcon(file.path)} />
              <span className="diff-plus-name diff-plus-name--flat" data-deleted={file.changeKind === "deleted" || undefined}>
                {fileName(file.path)}
              </span>
              <span className="diff-plus-dir">{dirName(file.path)}</span>
              <Stats additions={file.additions} deletions={file.deletions} />
              <span className="diff-plus-mark" data-tone={status.tone} title={status.title}>
                {status.mark}
              </span>
            </button>
          </div>
        );
      })}
    </>
  );
});

const SLIDE_MS = 160;
/** Room kept above or below the marked rows when the tree follows the list. */
const FOLLOW_MARGIN = 8;
/** How long the list has to be still before the tree follows it. */
const FOLLOW_QUIET_MS = 150;
/** A long steady scroll of the list still has the tree follow this often. */
const FOLLOW_MAX_WAIT_MS = 500;
/** How long after the reader moves the tree it stops following the list. */
const FOLLOW_PAUSE_MS = 1500;

/**
 * Slides the in-view bars when the line moves: a row that gains one slides it in
 * from the old line, a row that loses one slides it into the new line, in the
 * direction the line moved. The bars are opaque, so ones passing over each
 * other read as one line. With no bar on the other side (the first marks, or
 * all gone) the CSS fade does it.
 */
function slide(entering: Element[], leaving: Element[], before: Element[], after: Element[]) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const tops = new Map<Element, number>();
  const top = (row: Element) => {
    let value = tops.get(row);
    if (value === undefined) tops.set(row, (value = row.getBoundingClientRect().top));
    return value;
  };
  /**
   * The offset to the nearest row of `among` on the `toward` side of `row`
   * (-1 above, 1 below), or the nearest on either side when there is none.
   */
  const nearest = (row: Element, among: Element[], toward: number) => {
    let best: number | null = null;
    let any: number | null = null;
    for (const other of among) {
      const distance = top(other) - top(row);
      if (any === null || Math.abs(distance) < Math.abs(any)) any = distance;
      if (distance * toward > 0 && (best === null || Math.abs(distance) < Math.abs(best))) best = distance;
    }
    return best ?? any;
  };
  const mean = (rows: Element[]) => rows.reduce((sum, row) => sum + top(row), 0) / rows.length;
  const run = (row: Element, from: number, to: number, fade = false) => {
    row.setAttribute("data-sliding", "");
    const animation = row.animate(
      [
        { transform: `translateY(${from}px)`, opacity: 1 },
        { transform: `translateY(${to}px)`, opacity: fade ? 0 : 1 },
      ],
      { duration: SLIDE_MS, easing: "ease-out", pseudoElement: "::before" },
    );
    const done = () => {
      if (!row.getAnimations({ subtree: true }).some((other) => other !== animation && other.playState === "running"))
        row.removeAttribute("data-sliding");
    };
    animation.onfinish = done;
    animation.oncancel = done;
  };
  // Which way the line moved (-1 up, 1 down). Every bar travels that way: a
  // new one comes from the old line behind it, and one that goes slides on into
  // the new line ahead of it, fading as it goes.
  if (!before.length || !after.length) return;
  const way = Math.sign(mean(after) - mean(before)) || 1;
  for (const row of entering) {
    const from = nearest(row, before, -way);
    if (from !== null) run(row, from, 0);
  }
  for (const row of leaving) {
    const to = nearest(row, after, way);
    if (to !== null) run(row, 0, to, true);
  }
}

/**
 * Synced view: marks the rows of the files whose cards are on screen
 * in the list (or the closed folder holding one) with `data-in-view`, straight
 * on the DOM so a scroll never re-renders the tree. Nothing listens while off.
 * Returns a ref to the function that marks the rows again after a render.
 */
function useInView(tab: DiffTab, treeRef: React.RefObject<HTMLDivElement | null>, on: boolean, follows: boolean) {
  const remark = useRef<(() => void) | null>(null);
  // Read when a follow is asked for, so switching it needs no new listeners.
  const followsRef = useRef(follows);
  followsRef.current = follows;
  // When the reader last moved the tree; outside the effect, which runs again when a click changes the filter.
  const touched = useRef(0);
  useEffect(() => {
    if (!on) return;
    let paths: readonly string[] = [];
    let marked: Element[] = [];
    const rowFor = (root: Element, path: string) => {
      for (const candidate of withParents(path).reverse()) {
        const row = root.querySelector(`.diff-plus-row[data-path="${CSS.escape(candidate)}"]`);
        if (row) return row;
      }
      return null;
    };
    const mark = () => {
      const root = treeRef.current;
      const rows = new Set<Element>();
      if (root)
        for (const path of paths) {
          const row = rowFor(root, path);
          if (row) rows.add(row);
        }
      // An open folder's row inside the line carries it too (its files are
      // marked, not it), so the line runs on unbroken: one whose row above is
      // marked and whose next file (past more open folders) is.
      if (root && rows.size) {
        const all = [...root.querySelectorAll(".diff-plus-row[data-path]")];
        const open = (row: Element) => !!row.querySelector(':scope > .diff-plus-twisty[aria-expanded="true"]');
        all.forEach((row, index) => {
          if (!open(row) || rows.has(row) || !rows.has(all[index - 1]!)) return;
          let after = index + 1;
          while (all[after] && open(all[after]!)) after++;
          if (all[after] && rows.has(all[after]!)) for (let at = index; at < after; at++) rows.add(all[at]!);
        });
      }
      const next = [...rows].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      slide(
        next.filter((row) => !marked.includes(row)),
        marked.filter((row) => !rows.has(row) && row.isConnected),
        marked.filter((row) => rows.has(row) || row.isConnected),
        next,
      );
      for (const row of marked) if (!rows.has(row)) row.removeAttribute("data-in-view");
      for (const row of rows) row.setAttribute("data-in-view", "");
      marked = next;
    };
    remark.current = mark;
    // The tree follows the list: when the marked rows leave the tree's own
    // view, it scrolls just far enough to show them (their top, if they are
    // taller than it). Not while the reader is moving the tree itself. It waits
    // for the list to be still (`askFollow`), since each follow starts a smooth
    // scroll and a list scrolled fast back and forth would restart it all the time.
    const touch = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".diff-plus-tree-scroll")) touched.current = performance.now();
    };
    const inputs = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const type of inputs) tab.list.addEventListener(type, touch, { capture: true, passive: true });
    const follow = () => {
      const scroller = treeRef.current?.closest<HTMLElement>(".diff-plus-tree-scroll");
      if (!scroller || !marked.length || performance.now() - touched.current < FOLLOW_PAUSE_MS) return;
      if (scroller.scrollHeight <= scroller.clientHeight) return;
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const box = scroller.getBoundingClientRect();
      // "Changes" and the stuck folder rows cover the top of the view, down to the lowest of them.
      const changes = treeRef.current?.querySelector(".diff-plus-root")?.getBoundingClientRect().bottom ?? box.top;
      const covered = treeRef.current?.querySelector(".diff-plus-sticky[data-last]")?.getBoundingClientRect().bottom ?? changes;
      const view = { top: covered, bottom: box.bottom, height: box.bottom - covered };
      let top = Infinity;
      let bottom = -Infinity;
      for (const row of marked) {
        const rect = row.getBoundingClientRect();
        top = Math.min(top, rect.top);
        bottom = Math.max(bottom, rect.bottom);
      }
      // The list at an end puts the tree at the same end (a list that fits is at both),
      // but only if the marked rows stay in view there: they come first.
      const list = listScroller(tab);
      if (list && list.scrollHeight - list.clientHeight > 1) {
        if (list.scrollTop <= 1 && top + scroller.scrollTop >= changes && bottom + scroller.scrollTop <= box.bottom)
          return scroller.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
        const toEnd = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
        if (list.scrollTop + list.clientHeight >= list.scrollHeight - 1 && top - toEnd >= covered)
          return scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? "smooth" : "auto" });
      }
      if (top >= view.top && bottom <= view.bottom) return;
      const delta =
        bottom - top > view.height - 2 * FOLLOW_MARGIN || top < view.top ? top - view.top - FOLLOW_MARGIN : bottom - view.bottom + FOLLOW_MARGIN;
      scroller.scrollBy({ top: delta, behavior: smooth ? "smooth" : "auto" });
    };
    let followTimer = 0;
    let firstAsk = 0;
    const askFollow = () => {
      if (!followsRef.current) return;
      const now = performance.now();
      if (!followTimer) firstAsk = now;
      window.clearTimeout(followTimer);
      const wait = Math.max(0, Math.min(FOLLOW_QUIET_MS, firstAsk + FOLLOW_MAX_WAIT_MS - now));
      followTimer = window.setTimeout(() => {
        followTimer = 0;
        follow();
      }, wait);
    };
    const stop = watchVisibleCards(tab, (next) => {
      paths = next;
      mark();
      askFollow();
    });
    // Reaching an end of the list may change no card on screen (the first or
    // last is already showing), so the ends are watched on the list's scroll.
    let edge = 0;
    const onListScroll = (event: Event) => {
      const list = event.target;
      if (!(list instanceof HTMLElement) || list.closest(".diff-plus-tree")) return;
      if (list.scrollHeight - list.clientHeight <= 1) return;
      const at = list.scrollTop <= 1 ? -1 : list.scrollTop + list.clientHeight >= list.scrollHeight - 1 ? 1 : 0;
      if (at !== edge && (edge = at)) askFollow();
    };
    tab.list.addEventListener("scroll", onListScroll, { capture: true, passive: true });
    return () => {
      stop();
      window.clearTimeout(followTimer);
      for (const type of inputs) tab.list.removeEventListener(type, touch, { capture: true });
      tab.list.removeEventListener("scroll", onListScroll, { capture: true });
      remark.current = null;
      for (const row of marked) row.removeAttribute("data-in-view");
    };
  }, [tab, treeRef, on]);
  return remark;
}

const ROW_HEIGHT = 24;
/** Where the stuck folder rows start: right under "Changes" itself, over its 2px gap (as in the CSS). */
const PINNED_TOP = 24;
/** Most folder rows stuck at once ("Changes" is above them all: z-index MAX_PINNED + 1 in the CSS). */
const MAX_PINNED = 7;
/** Share of the tree's view the stuck rows may take. */
const PINNED_SHARE = 0.4;

/**
 * Sticky folder rows are the browser's: an open folder's row (`diff-plus-sticky`,
 * see `Rows`) is `position: sticky` at `PINNED_TOP + depth * ROW_HEIGHT` in its
 * own wrapper. This hook only places the one shadow: `data-last` on the lowest
 * stuck folder row (or none, and `data-pinned` on the tree root, for "Changes"
 * to cast it), and `data-stuck` on "Changes" once the tree has scrolled. Per
 * level it binary-searches the non-sticky rows (sticky ones are out of flow
 * order on screen) for the first one past that level's spot; its open folders
 * give the folder at that depth, stuck once its wrapper's top is up to the spot.
 */
function useStuckRows(treeRef: React.RefObject<HTMLDivElement | null>, on: boolean, room: number) {
  const rows = useRef<ArrayLike<HTMLElement> | null>(null);
  const last = useRef<Element | null>(null);
  const read = useRef<() => void>(() => {});
  read.current = () => {
    const root = treeRef.current;
    const scroller = root?.closest<HTMLElement>(".diff-plus-tree-scroll");
    const stuck = !!scroller && scroller.scrollTop > 0;
    let lowest: HTMLElement | null = null;
    if (on && root && scroller && stuck) {
      const stackTop = scroller.getBoundingClientRect().top + PINNED_TOP;
      const list = (rows.current ??= root.querySelectorAll<HTMLElement>(".diff-plus-row[data-path]:not(.diff-plus-sticky)"));
      let lowestBottom = -Infinity;
      let parent: Element | null = null;
      for (let level = 0; level < room; level++) {
        const spot = stackTop + level * ROW_HEIGHT;
        let low = 0;
        let high = list.length - 1;
        let found = -1;
        while (low <= high) {
          const middle = (low + high) >> 1;
          if (list[middle]!.getBoundingClientRect().bottom > spot) {
            found = middle;
            high = middle - 1;
          } else low = middle + 1;
        }
        if (found < 0) break;
        // The open folders holding that row, outermost first.
        const chain: HTMLElement[] = [];
        for (let group = list[found]!.closest('[role="group"]'); group; group = group.parentElement?.closest('[role="group"]') ?? null) {
          const folder = group.previousElementSibling;
          if (folder instanceof HTMLElement) chain.unshift(folder);
        }
        const folder = chain[level];
        const wrapper = folder?.parentElement;
        // The wrapper's top is where the row would be without sticking.
        if (!folder || !wrapper || wrapper.getBoundingClientRect().top > spot || (parent && !parent.contains(folder))) break;
        const bottom = folder.getBoundingClientRect().bottom;
        if (bottom > lowestBottom) {
          lowest = folder;
          lowestBottom = bottom;
        }
        parent = wrapper;
      }
    }
    // Writes after the reads, so nothing here forces a layout.
    root?.querySelector(".diff-plus-root")?.toggleAttribute("data-stuck", stuck);
    if (lowest !== last.current) {
      last.current?.removeAttribute("data-last");
      lowest?.setAttribute("data-last", "");
      last.current = lowest;
      root?.toggleAttribute("data-pinned", lowest !== null);
    }
  };
  // Layout effect: a render that moved the rows never paints a stale shadow first.
  useLayoutEffect(() => {
    rows.current = null;
    read.current();
  });
  useEffect(() => {
    // On the document, capturing: the tree's scroller mounts after loading
    // and can be replaced, and scroll events do not bubble.
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.matches(".diff-plus-tree-scroll") || !event.target.contains(treeRef.current)) return;
      read.current();
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, [treeRef]);
}

interface TreeColumnProps {
  tab: DiffTab;
  filter: string;
  scope: Scope | null;
  files: Files;
  tree: TreeDir | null;
  /** The files the tree holds, in BB's list order. */
  shown: readonly TreeFile[] | null;
  paths: Set<string> | null;
  setOpen: React.Dispatch<React.SetStateAction<{ key: string; paths: Set<string> } | null>>;
}

function TreeColumn({ tab, filter, scope, files, tree, shown, paths, setOpen }: TreeColumnProps) {
  const toggle = useCallback(
    (path: string) =>
      setOpen((previous) => {
        if (!previous) return previous;
        const next = new Set(previous.paths);
        if (!next.delete(path)) next.add(path);
        return { ...previous, paths: next };
      }),
    [setOpen],
  );
  const known = useMemo(() => new Set(files.status === "ready" ? files.files.map((file) => file.path) : []), [files]);
  const { view, synced, syncScroll, syncBars } = useOptions();
  const treeRef = useRef<HTMLDivElement | null>(null);
  const remark = useInView(tab, treeRef, synced && (syncScroll || syncBars), syncScroll);
  // Rows opened, closed or swapped by this render are marked again.
  useLayoutEffect(() => remark.current?.());
  const flat = useMemo(() => (view !== "list" || !tree ? null : synced ? shown : listFiles(tree)), [view, tree, synced, shown]);
  const lit = useMemo((): Lit | null => {
    if (files.status !== "ready") return null;
    const matched = filterMatches(files.files, filter);
    if (!matched) return null;
    const dirs = new Set<string>();
    for (const path of matched) for (const dir of withParents(path).slice(0, -1)) dirs.add(dir);
    const count = (paths: Iterable<string>) => {
      const counts = new Map<string, number>();
      for (const path of paths) for (const dir of withParents(path).slice(0, -1)) counts.set(dir, (counts.get(dir) ?? 0) + 1);
      return counts;
    };
    const total = count(files.files.map((file) => file.path));
    const hits = count(matched);
    const whole = new Set<string>();
    for (const [dir, n] of hits) if (n === total.get(dir)) whole.add(dir);
    return { files: matched, dirs, whole };
  }, [files, filter]);
  const selected = selectedBy(filter, (path) => known.has(path));
  const active = selected ? `${selected.kind}:${selected.path}` : null;
  const pick = useCallback(
    (kind: "dir" | "file", path: string) => {
      if (active === `${kind}:${path}`) {
        void setFilter(tab, "");
        return;
      }
      if (tree) {
        setOpen((previous) => {
          if (!previous) return previous;
          const next = new Set(previous.paths);
          for (const dir of ancestors(tree, path)) next.add(dir);
          if (kind === "dir") next.add(path);
          return { ...previous, paths: next };
        });
      }
      const pattern = kind === "dir" ? folderPattern(path) : filePattern(path, files.status === "ready" ? files.files : []);
      void setFilter(tab, pattern).then((done) => {
        if (!done) return;
        scrollListToTop(tab);
        if (kind === "file") void expandFile(tab, path);
      });
    },
    [active, tab, tree, files, setOpen],
  );

  const setAllOpen = useCallback(
    (all: boolean) => tree && setOpen((previous) => previous && { ...previous, paths: all ? allDirs(tree) : new Set() }),
    [tree, setOpen],
  );
  const anyOpen = useMemo(() => (tree && paths ? [...allDirs(tree)].some((dir) => paths.has(dir)) : false), [tree, paths]);
  // How many folder rows may stick: what 40% of the tree's view holds, up to MAX_PINNED.
  const [room, setRoom] = useState(MAX_PINNED);
  const hasRows = !!tree?.count && !!paths;
  useLayoutEffect(() => {
    const scroller = treeRef.current?.closest<HTMLElement>(".diff-plus-tree-scroll");
    if (!scroller) return;
    const measure = () => setRoom(Math.min(MAX_PINNED, Math.floor((PINNED_SHARE * scroller.clientHeight) / ROW_HEIGHT)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [hasRows]);
  useStuckRows(treeRef, !flat, room);

  if (!scope) return <p className="diff-plus-tree-note">No folder tree for this view.</p>;
  if (files.status === "loading") return <p className="diff-plus-tree-note">Loading files…</p>;
  if (files.status === "error")
    return (
      <p className="diff-plus-tree-note" role="alert">
        {files.message}
      </p>
    );
  if (!tree || !paths) return null;
  if (!tree.count) {
    const hidden = files.status === "ready" && files.files.length > 0;
    return <p className="diff-plus-tree-note">{hidden ? "No files match the filter." : "No changes."}</p>;
  }
  return (
    <div role="tree" aria-label="Changed files by folder" ref={treeRef} data-show-in-view={(synced && syncBars) || undefined}>
      {/* "Changes" shows every file and carries the selection itself, so the fold
          button beside it and the totals stay on the plain background. */}
      <div className="diff-plus-row diff-plus-root">
        <button
          type="button"
          className="diff-plus-pick diff-plus-root-label"
          role="treeitem"
          aria-selected={!filter.trim()}
          data-active={!filter.trim() || undefined}
          title="Show every file"
          onClick={() => filter.trim() && void setFilter(tab, "")}
        >
          <span className="diff-plus-name">Changes</span>
        </button>
        <span className="diff-plus-root-buttons">
          <ViewMenu />
          {!flat && (
            <button
              type="button"
              className="diff-plus-fold-all"
              aria-label={anyOpen ? "Collapse all folders" : "Expand all folders"}
              title={anyOpen ? "Collapse all folders" : "Expand all folders"}
              onClick={() => setAllOpen(!anyOpen)}
            >
              <Icon name={anyOpen ? "ChevronsUp" : "ChevronsDown"} className="diff-plus-icon" aria-hidden />
            </button>
          )}
        </span>
        <span className="diff-plus-fill" />
        <span className="diff-plus-count">{tree.count}</span>
        <Stats additions={tree.additions} deletions={tree.deletions} />
        {/* The letters' room, so the root's +/- line up with the rows'. */}
        <span className="diff-plus-mark" />
      </div>
      {flat ? (
        <FlatRows files={flat} active={active} pick={pick} lit={lit} />
      ) : (
        <Rows dir={tree} depth={0} open={paths} room={room} active={active} toggle={toggle} pick={pick} lit={lit} />
      )}
      {files.truncated && <p className="diff-plus-tree-note">BB cut this list short; filter by path to find the rest.</p>}
    </div>
  );
}
