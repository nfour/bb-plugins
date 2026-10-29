import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { editorOf, onStowChange, stowedShells, unstow } from "./dom";
import { ReturnIcon } from "./icons";
import { useOptions } from "./options";

/**
 * Keep-docked mode's way back. For each stowed shell (see `stow` in `dom.ts`) a row
 * sits where the composer was, at the bottom of the timeline, showing the start
 * of the draft. Pressing it unstows the shell: a one-off, not a setting, so the
 * next time the panel opens the composer docks again as usual.
 */
export function Return() {
  const { ready, enabled, keepDocked } = useOptions();
  const on = ready && enabled && keepDocked;
  const [shells, setShells] = useState<HTMLElement[]>([]);

  useEffect(() => {
    if (!on) {
      // Switched off with a composer stowed: show it again where it is.
      if (ready) for (const shell of stowedShells()) unstow(shell);
      setShells([]);
      return;
    }
    const refresh = () => setShells(stowedShells());
    refresh();
    return onStowChange(refresh);
  }, [on, ready]);

  // A stowed shell goes when BB tears its column down (another thread, a layout
  // change); nothing announces that, so look once a second, and only while one is stowed.
  useEffect(() => {
    if (shells.length === 0) return;
    const timer = window.setInterval(() => {
      if (shells.some((shell) => !shell.isConnected)) setShells(stowedShells());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [shells]);

  return (
    <>
      {shells.map((shell) => (
        <Row key={keyOf(shell)} shell={shell} />
      ))}
    </>
  );
}

const keys = new WeakMap<HTMLElement, number>();
let nextKey = 0;
function keyOf(shell: HTMLElement): number {
  let key = keys.get(shell);
  if (key === undefined) keys.set(shell, (key = nextKey++));
  return key;
}

/** The start of the draft, on one line; empty for an empty box. */
function draftOf(shell: HTMLElement): string {
  const editor = editorOf(shell);
  const text = editor instanceof HTMLTextAreaElement ? editor.value : (editor?.textContent ?? "");
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

function Row({ shell }: { shell: HTMLElement }) {
  // The row's host is BB's element's sibling, like the shell's own marker.
  const host = useMemo(() => {
    const element = document.createElement("div");
    element.dataset.chatDockReturn = "";
    return element;
  }, []);
  useLayoutEffect(() => {
    shell.parentNode?.insertBefore(host, shell);
    return () => host.remove();
  }, [shell, host]);
  // The draft cannot change while the box is stowed.
  const draft = useMemo(() => draftOf(shell), [shell]);
  const label = draft ? "Return composer here, draft kept" : "Return composer here";

  return createPortal(
    <button
      type="button"
      className="chat-dock-return"
      aria-label={label}
      title={label}
      onClick={() => {
        unstow(shell);
        // A pointer that can type right away gets the caret; a touch screen keeps its keyboard down.
        if (window.matchMedia("(pointer: fine)").matches) editorOf(shell)?.focus();
      }}
    >
      <ReturnIcon className="chat-dock-return-icon" />
      <span className="chat-dock-return-label">Return composer</span>
      <span className="chat-dock-return-draft" aria-hidden>
        {draft ? `“${draft}”` : ""}
      </span>
    </button>,
    host,
  );
}
