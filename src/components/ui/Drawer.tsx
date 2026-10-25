"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconButton } from "./Button";
import { cx } from "./cx";

/**
 * Right-hand drawer on the native <dialog> element. Modal drawers trap focus and lock page
 * scrolling; non-modal drawers leave the page usable beside them (for example selecting
 * rows while reviewing). Both close on Escape and return focus to the opener.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  modal = true,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  modal?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (modal) el.showModal();
      else {
        el.show();
        el.querySelector<HTMLElement>("[data-drawer-close]")?.focus();
      }
    }
    if (!open && el.open) el.close();
  }, [open, modal]);

  useEffect(() => {
    if (!open || !modal) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, [open, modal]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      aria-modal={modal || undefined}
      onClose={() => {
        onClose();
        const target = opener.current;
        opener.current = null;
        if (target?.isConnected) target.focus({ preventScroll: true });
      }}
      onCancel={(e) => {
        e.preventDefault();
        ref.current?.close();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !modal) {
          e.preventDefault();
          ref.current?.close();
        }
      }}
      className={cx(
        "fixed inset-y-0 right-0 left-auto z-40 m-0 h-dvh max-h-dvh w-full max-w-[min(32rem,100vw)] border-l border-rule bg-surface p-0 text-ink shadow-overlay backdrop:bg-[rgba(9,10,11,0.72)]",
        className,
      )}
    >
      {open && (
        <div className="flex h-full flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-[1.15rem] font-medium tracking-[-0.03em] text-ink-strong">
                {title}
              </h2>
              {description && (
                <div id={descId} className="mt-1 text-[13px] leading-5 text-ink-muted">
                  {description}
                </div>
              )}
            </div>
            <IconButton label={`Close ${title}`} data-drawer-close onClick={() => ref.current?.close()}>
              <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </IconButton>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      )}
    </dialog>
  );
}
