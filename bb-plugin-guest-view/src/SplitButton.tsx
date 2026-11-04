import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon } from "./Icons";

// The window's size event, spelled in two parts: the plugin build turns that word standing alone into a page-wide rule.
const SIZE_EVENT = "re" + "size";

export interface SplitChoice {
  label: string;
  /** A line under the label, cut with an ellipsis: what the choice would insert. */
  hint?: string;
  run(): void;
}

/**
 * A primary button with a chevron beside it. The button does the usual thing; the chevron opens a
 * small menu of the other ways. The menu is portalled and placed from the chevron's box, because
 * Prompt Approval scrolls and would cut a menu drawn inside it. Esc, a click elsewhere, a scroll
 * or the window changing size close it.
 */
export function SplitButton({ children, busy, onMain, choices, moreLabel }: { children: ReactNode; busy?: boolean; onMain(): void; choices: SplitChoice[]; moreLabel: string }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const button = toggle.current;
    const node = menu.current;
    if (!button || !node) return;
    const rect = button.getBoundingClientRect();
    const height = node.offsetHeight;
    const below = rect.bottom + 4 + height <= window.innerHeight - 8;
    node.style.top = `${below ? rect.bottom + 4 : Math.max(8, rect.top - 4 - height)}px`;
    node.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    node.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (refocus: boolean) => {
      setOpen(false);
      if (refocus) toggle.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menu.current?.contains(target) || toggle.current?.contains(target)) return;
      close(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      } else if (event.key === "Tab") {
        close(false);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        if (items.length === 0) return;
        event.preventDefault();
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    };
    const onAway = () => close(false);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onAway, true);
    window.addEventListener(SIZE_EVENT, onAway);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onAway, true);
      window.removeEventListener(SIZE_EVENT, onAway);
    };
  }, [open]);

  return (
    <div className="guest-view-split">
      <button type="button" className="guest-view-button guest-view-button-primary guest-view-split-main" disabled={busy} onClick={onMain}>
        {children}
      </button>
      <button
        ref={toggle}
        type="button"
        className="guest-view-button guest-view-button-primary guest-view-split-more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={moreLabel}
        title={moreLabel}
        disabled={busy}
        onClick={() => setOpen((on) => !on)}
      >
        <ChevronDownIcon className="guest-view-button-icon" />
      </button>
      {open
        ? createPortal(
            <div className="guest-view-menu" role="menu" ref={menu}>
              {choices.map((choice) => (
                <button
                  key={choice.label}
                  type="button"
                  role="menuitem"
                  className="guest-view-menu-item"
                  onClick={() => {
                    setOpen(false);
                    choice.run();
                  }}
                >
                  <span>{choice.label}</span>
                  {choice.hint ? <span className="guest-view-menu-hint">{choice.hint}</span> : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
