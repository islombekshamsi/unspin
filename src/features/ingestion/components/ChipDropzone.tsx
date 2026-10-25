"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { formatBytes } from "../lib/format";

export type FileChipStatus =
  "waiting" | "checking" | "confirmed" | "refused" | "cancelled";

export interface FileChip {
  id: string;
  file: File;
  status: FileChipStatus;
  note?: string;
}

/**
 * Drop area that turns each dropped or chosen file into a chip.
 * The chip label comes from the file name only; the server decides the real type.
 */
export function ChipDropzone({
  accept,
  busy,
  chips,
  onFiles,
  onOpen,
  onRemove,
  onCancel,
  footer,
}: {
  accept: string;
  busy: boolean;
  chips: FileChip[];
  onFiles: (files: File[]) => void;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  onCancel: () => void;
  footer?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const active = chips.find(
    (chip) => chip.status === "checking" || chip.status === "confirmed",
  );
  const listed = chips.filter((chip) => chip !== active);

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length) onFiles(files);
      }}
      data-dragging={dragging || undefined}
      className="group relative isolate flex h-full min-h-[360px] flex-col overflow-hidden rounded-[28px] bg-[#0d1114] p-3 sm:p-4"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div className="absolute -inset-[20%] bg-[radial-gradient(60%_55%_at_20%_15%,rgba(64,124,255,0.55),transparent_70%),radial-gradient(55%_60%_at_80%_30%,rgba(22,190,170,0.5),transparent_70%),radial-gradient(60%_60%_at_55%_95%,rgba(120,220,140,0.35),transparent_70%)] opacity-95 blur-2xl transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-dragging:scale-110 group-data-dragging:opacity-100" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(9,10,11,0)_30%,rgba(9,10,11,0.55)_100%)]" />
      </div>

      <div
        className={cx(
          "relative flex flex-1 flex-col items-center justify-center gap-4 overflow-hidden rounded-[22px] border px-5 py-10 text-center transition-[border-color,background-color,box-shadow] duration-500",
          active?.status === "confirmed"
            ? "border-solid border-[#8ee8db] bg-[rgba(9,10,11,0.34)] shadow-[inset_0_0_0_1px_rgba(142,232,219,0.35),0_0_40px_rgba(142,232,219,0.18)]"
            : active
              ? "border-solid border-[rgba(182,255,244,0.55)] bg-[rgba(9,10,11,0.4)]"
              : dragging
                ? "border-dashed border-[#b6fff4] bg-[rgba(9,10,11,0.18)]"
                : "border-dashed border-[rgba(247,246,243,0.32)] bg-[rgba(9,10,11,0.28)]",
        )}
      >
        {active ? (
          <ActiveFile chip={active} onCancel={onCancel} />
        ) : (
          <div
            key="idle"
            className="flex flex-col items-center gap-4 transition-[opacity,transform] duration-300 starting:translate-y-2 starting:opacity-0"
          >
            <DropGlyph active={dragging} />
            <div>
              <p className="text-[clamp(1.35rem,2.4vw,1.9rem)] leading-tight font-medium tracking-[-0.03em] text-[#f7f6f3]">
                {dragging
                  ? "Release to add"
                  : "Drop a chart, PDF, or spreadsheet"}
              </p>
              <p className="mt-2 text-[14px] text-[rgba(247,246,243,0.78)]">
                Each file becomes a chip. Open one at a time.
              </p>
            </div>
          </div>
        )}
        <input
          ref={inputRef}
          id={id}
          type="file"
          multiple
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) onFiles(files);
            e.target.value = "";
          }}
        />
        <label
          htmlFor={id}
          hidden={!!active}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          className="inline-flex min-h-10 cursor-pointer items-center rounded-full border border-[rgba(255,255,255,0.28)] bg-[rgba(32,36,40,0.82)] px-5 text-[14px] font-medium text-[#f7f6f3] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] backdrop-blur-xl transition-[background-color,transform] duration-200 hover:bg-[rgba(46,52,58,0.92)] active:scale-[0.98]"
        >
          Choose files
        </label>
        {footer && !active && (
          <div className="font-mono text-[12px] tracking-[0.1em] text-[rgba(247,246,243,0.78)]">
            {footer}
          </div>
        )}
      </div>

      {listed.length > 0 && (
        <ul
          aria-label="Files"
          aria-live="polite"
          className="mt-3 flex flex-wrap gap-2"
        >
          {listed.map((chip) => (
            <Chip
              key={chip.id}
              chip={chip}
              busy={busy}
              onOpen={() => onOpen(chip.id)}
              onRemove={() => onRemove(chip.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ActiveFile({
  chip,
  onCancel,
}: {
  chip: FileChip;
  onCancel: () => void;
}) {
  const ext = extensionOf(chip.file.name);
  const confirmed = chip.status === "confirmed";
  return (
    <div
      role="status"
      className="flex w-full max-w-md flex-col items-center gap-4 transition-[opacity,transform] duration-300 starting:translate-y-2 starting:opacity-0"
    >
      <span
        aria-hidden="true"
        className="relative grid size-14 place-items-center"
      >
        {!confirmed && (
          <svg
            viewBox="0 0 64 64"
            className="absolute -inset-2 size-[72px] animate-spin [animation-duration:1.1s]"
          >
            <circle
              cx="32"
              cy="32"
              r="29"
              fill="none"
              stroke="rgba(142,232,219,0.18)"
              strokeWidth="2.5"
            />
            <circle
              cx="32"
              cy="32"
              r="29"
              fill="none"
              stroke="#8ee8db"
              strokeWidth="2.5"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray="28 72"
            />
          </svg>
        )}
        <span
          key={confirmed ? "done" : "busy"}
          className={cx(
            "grid size-14 place-items-center rounded-full border transition-[transform,background-color,opacity] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] starting:scale-75 starting:opacity-0",
            confirmed
              ? "border-[#8ee8db] bg-[#8ee8db] text-[#071513] shadow-[0_0_0_8px_rgba(142,232,219,0.16)]"
              : "border-[rgba(255,255,255,0.28)] bg-[rgba(32,36,40,0.6)] text-[#8ee8db] backdrop-blur-xl",
          )}
        >
          {confirmed ? (
            <svg
              viewBox="0 0 24 24"
              className="size-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path
                d="M5.5 12.5l4.5 4.5 8.5-10"
                pathLength={1}
                className="[stroke-dasharray:1] [stroke-dashoffset:0] transition-[stroke-dashoffset] delay-150 duration-400 starting:[stroke-dashoffset:1]"
              />
            </svg>
          ) : (
            <KindGlyph ext={ext} className="size-6" />
          )}
        </span>
      </span>
      <div
        key={chip.status}
        className="min-w-0 max-w-full transition-[opacity,transform] duration-300 starting:translate-y-1 starting:opacity-0"
      >
        <p className="text-[clamp(1.35rem,2.4vw,1.9rem)] leading-tight font-medium tracking-[-0.03em] text-[#f7f6f3]">
          {confirmed ? "Confirmed" : "Checking your file"}
        </p>
        <p
          className="mt-2 truncate text-[14px] text-[rgba(247,246,243,0.78)]"
          title={chip.file.name}
        >
          {confirmed
            ? "Opening the selection step"
            : `Uploading ${chip.file.name}`}
        </p>
      </div>
      <div
        aria-hidden="true"
        className="h-1 w-full max-w-[260px] overflow-hidden rounded-full bg-[rgba(247,246,243,0.14)]"
      >
        {confirmed ? (
          <span className="block h-full w-full rounded-full bg-[#8ee8db] transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] starting:w-2/5" />
        ) : (
          <span className="indeterminate-bar block h-full w-2/5 rounded-full bg-[#8ee8db]" />
        )}
      </div>
      <p className="font-mono text-[12px] tracking-[0.1em] text-[rgba(247,246,243,0.66)]">
        {ext ? `${ext} · ` : ""}
        {formatBytes(chip.file.size)}
      </p>
      {!confirmed && (
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-10 items-center rounded-full border border-[rgba(255,255,255,0.28)] bg-[rgba(32,36,40,0.82)] px-5 text-[14px] font-medium text-[#f7f6f3] backdrop-blur-xl transition-[background-color,transform] duration-200 hover:bg-[rgba(46,52,58,0.92)] active:scale-[0.98]"
        >
          Cancel
        </button>
      )}
    </div>
  );
}

function Chip({
  chip,
  busy,
  onOpen,
  onRemove,
}: {
  chip: FileChip;
  busy: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const ext = extensionOf(chip.file.name);
  const tone =
    chip.status === "refused"
      ? "border-[rgba(255,138,128,0.55)] bg-[rgba(255,138,128,0.12)]"
      : "border-[rgba(247,246,243,0.22)] bg-[rgba(20,23,26,0.78)]";

  return (
    <li
      className={cx(
        "relative flex max-w-full min-w-0 items-center gap-2 overflow-hidden rounded-full border py-1.5 pr-1.5 pl-2 text-[13px] text-[#f4f0e6] backdrop-blur-xl",
        "transition-[opacity,transform,background-color,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] starting:translate-y-2 starting:scale-90 starting:opacity-0",
        tone,
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 place-items-center rounded-full bg-[rgba(142,232,219,0.16)] text-[#8ee8db]"
      >
        <KindGlyph ext={ext} className="size-3.5" />
      </span>
      <span className="min-w-0 truncate" title={chip.file.name}>
        {chip.file.name}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-[#9c978e]">
        {ext ? `${ext} · ` : ""}
        {formatBytes(chip.file.size)}
      </span>
      <span
        key={chip.status}
        className="shrink-0 text-[12px] text-[#c9c3b6] transition-[opacity,transform] duration-300 starting:translate-y-1 starting:opacity-0"
      >
        {statusLabel(chip)}
      </span>
      {!busy && (
        <ChipButton label={`Open ${chip.file.name}`} onClick={onOpen}>
          {chip.status === "waiting" ? "Open" : "Retry"}
        </ChipButton>
      )}
      <button
        type="button"
        aria-label={`Remove ${chip.file.name}`}
        onClick={onRemove}
        className="grid size-7 shrink-0 place-items-center rounded-full text-[#c9c3b6] transition-colors hover:bg-[rgba(247,246,243,0.12)] hover:text-[#f4f0e6]"
      >
        <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </li>
  );
}

function ChipButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="h-7 shrink-0 rounded-full bg-[rgba(247,246,243,0.12)] px-3 text-[12px] font-medium text-[#f4f0e6] transition-colors hover:bg-[rgba(247,246,243,0.2)]"
    >
      {children}
    </button>
  );
}

function statusLabel(chip: FileChip): string {
  switch (chip.status) {
    case "refused":
      return "Not opened";
    case "cancelled":
      return "Cancelled";
    default:
      return "Waiting";
  }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1
    ? name.slice(dot + 1).toUpperCase()
    : "";
}

function KindGlyph({ ext, className }: { ext: string; className: string }) {
  const kind = ["CSV", "XLSX"].includes(ext)
    ? "sheet"
    : ["PNG", "JPG", "JPEG", "WEBP"].includes(ext)
      ? "image"
      : "doc";
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    >
      {kind === "sheet" ? (
        <>
          <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
          <path d="M2.5 6.5h11M2.5 9.75h11M6.5 3v10" />
        </>
      ) : kind === "image" ? (
        <>
          <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
          <path d="M3.5 11.5l3-3 2 2 1.5-1.5 2.5 2.5" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M4 2.5h5l3 3v8H4z" />
          <path d="M9 2.5v3h3M6 8.5h4M6 10.75h4" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

function DropGlyph({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid size-14 place-items-center rounded-2xl border border-[rgba(255,255,255,0.28)] bg-[rgba(32,36,40,0.6)] text-[#f7f6f3] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-xl transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        active && "-translate-y-1 scale-105",
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" />
        <path d="M4 14v3.5A2.5 2.5 0 006.5 20h11a2.5 2.5 0 002.5-2.5V14" />
      </svg>
    </span>
  );
}
