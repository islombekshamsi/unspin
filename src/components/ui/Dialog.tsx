"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconButton } from "./Button";
import { cx } from "./cx";

/**
 * Modal dialog on the native <dialog> element: focus trapping, Escape to close,
 * and focus return come from the platform.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cx(
        "m-auto w-[min(640px,calc(100vw-2rem))] max-h-[calc(100vh-4rem)] rounded-lg border border-rule bg-surface p-0 text-ink shadow-overlay backdrop:bg-ink/30",
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[calc(100vh-4rem)] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
            <div>
              <h2 id={titleId} className="text-base font-semibold">
                {title}
              </h2>
              {description && (
                <div id={descId} className="mt-1 text-[13px] leading-5 text-ink-muted">
                  {description}
                </div>
              )}
            </div>
            <IconButton label="Close dialog" onClick={onClose}>
              <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </IconButton>
          </header>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-rule px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
