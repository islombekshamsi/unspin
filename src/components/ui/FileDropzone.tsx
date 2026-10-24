"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";

/**
 * Keyboard-accessible file picker; drag-and-drop is an enhancement only.
 * Validation is the caller's job (and the server's).
 */
export function FileDropzone({
  accept,
  disabled,
  onFile,
  title,
  children,
  className,
}: {
  accept: string;
  disabled?: boolean;
  onFile: (file: File) => void;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const [dragging, setDragging] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (disabled) return;
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      className={cx(
        "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
        dragging ? "border-accent bg-accent-soft" : "border-rule-strong bg-surface",
        disabled && "opacity-60",
        className,
      )}
    >
      <div className="text-base font-medium text-ink">{title}</div>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
      <label
        htmlFor={id}
        className={cx(
          "inline-flex h-10 cursor-pointer items-center rounded-md border border-accent bg-accent px-4 text-sm font-medium text-accent-ink hover:bg-accent-strong",
          "has-[:focus-visible]:outline-2",
          disabled && "pointer-events-none",
        )}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        tabIndex={disabled ? -1 : 0}
        role="button"
        aria-disabled={disabled || undefined}
      >
        Choose a file
      </label>
      {children && <div className="text-[13px] leading-5 text-ink-muted">{children}</div>}
    </div>
  );
}
