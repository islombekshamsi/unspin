"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";

export interface MenuItem {
  id: string;
  label: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  hint?: string;
}

/**
 * Labelled overflow menu (menu button pattern): arrow keys move between items,
 * Escape and outside clicks close it, and focus returns to the button.
 */
export function Menu({ label, items, align = "end", className }: { label: ReactNode; items: MenuItem[]; align?: "start" | "end"; className?: string }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const enabled = items.filter((i) => !i.disabled);

  const focusItem = (index: number) => {
    const nodes = listRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not([disabled])");
    if (!nodes || nodes.length === 0) return;
    nodes[(index + nodes.length) % nodes.length].focus();
  };

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => focusItem(0));
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!listRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  return (
    <div className={cx("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="inline-flex h-10 items-center gap-1.5 rounded-full border border-rule-strong bg-surface px-4 text-[14px] font-medium text-ink transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-raised enabled:active:scale-[0.98]"
      >
        {label}
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-ink-muted" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <div
          ref={listRef}
          id={menuId}
          role="menu"
          aria-label={typeof label === "string" ? label : undefined}
          onKeyDown={(e) => {
            const nodes = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not([disabled])") ?? [])];
            const i = nodes.indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              focusItem(i + 1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              focusItem(i - 1);
            } else if (e.key === "Home") {
              e.preventDefault();
              focusItem(0);
            } else if (e.key === "End") {
              e.preventDefault();
              focusItem(enabled.length - 1);
            } else if (e.key === "Escape") {
              e.preventDefault();
              close(true);
            } else if (e.key === "Tab") {
              close(false);
            }
          }}
          className={cx(
            "absolute top-full z-50 mt-1.5 min-w-56 rounded-2xl border border-rule bg-raised p-1.5 shadow-overlay",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              tabIndex={-1}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
              className="flex w-full flex-col items-start rounded-xl px-3 py-2 text-left text-sm text-ink hover:bg-sunken focus:bg-sunken focus:outline-none disabled:text-ink-faint"
            >
              <span>{item.label}</span>
              {item.hint && <span className="text-[12px] text-ink-muted">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
