"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { Button, NumericInput } from "@/components/ui";
import { isValidNormRect, type NormRect } from "@/server/sources/geometry";

const MIN_DRAG = 0.01;
const KEYS = ["x", "y", "width", "height"] as const;
type Key = (typeof KEYS)[number];
const KEY_LABEL: Record<Key, string> = { x: "Left", y: "Top", width: "Width", height: "Height" };

const pct = (v: number) => String(Math.round(v * 1000) / 10);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Drag-to-select region over a visual of known aspect ratio, with a numeric
 * (percent) alternative and keyboard nudging. Values are normalized to the
 * displayed, orientation-corrected source.
 */
export function RegionSelector({
  aspect,
  value,
  onChange,
  wholeLabel,
  surfaceLabel,
  maxHeight = "70vh",
  children,
}: {
  aspect: number;
  value: NormRect | null;
  onChange: (r: NormRect | null) => void;
  wholeLabel: string;
  surfaceLabel: string;
  maxHeight?: string;
  children: ReactNode;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const [live, setLive] = useState<NormRect | null>(null);
  const [draft, setDraft] = useState<Record<Key, string> | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const helpId = useId();
  const shown = live ?? value;

  const point = (e: React.PointerEvent) => {
    const r = surfaceRef.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };
  const rectFrom = (a: { x: number; y: number }, b: { x: number; y: number }): NormRect => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  });

  const commitDraft = () => {
    if (!draft) return;
    const nums = KEYS.map((k) => Number(draft[k].trim().replace(/%$/, "")));
    if (nums.some((n) => !Number.isFinite(n))) return setInputError("Enter numbers between 0 and 100.");
    const [x, y, width, height] = nums.map((n) => n / 100);
    const r = { x, y, width, height };
    if (!isValidNormRect(r)) return setInputError("The region must have a positive size and stay inside the source (left + width ≤ 100, top + height ≤ 100).");
    setInputError(null);
    setDraft(null);
    onChange(r);
  };

  const nudge = (e: React.KeyboardEvent) => {
    if (!value) return;
    const step = e.altKey ? 0.001 : 0.01;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    const next = e.shiftKey
      ? { ...value, width: Math.min(1 - value.x, Math.max(MIN_DRAG, value.width + d[0])), height: Math.min(1 - value.y, Math.max(MIN_DRAG, value.height + d[1])) }
      : { ...value, x: Math.min(1 - value.width, Math.max(0, value.x + d[0])), y: Math.min(1 - value.height, Math.max(0, value.y + d[1])) };
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative mx-auto w-full overflow-hidden rounded-md border border-rule bg-sunken"
        style={{ aspectRatio: String(aspect), maxWidth: `min(100%, calc(${maxHeight} * ${aspect}))` }}
      >
        {children}
        <div
          ref={surfaceRef}
          role="application"
          aria-label={surfaceLabel}
          aria-describedby={helpId}
          tabIndex={0}
          className="absolute inset-0 cursor-crosshair touch-none"
          onKeyDown={nudge}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const p = point(e);
            drag.current = { ...p, id: e.pointerId };
            e.currentTarget.setPointerCapture(e.pointerId);
            setLive({ x: p.x, y: p.y, width: 0, height: 0 });
          }}
          onPointerMove={(e) => {
            if (!drag.current || drag.current.id !== e.pointerId) return;
            setLive(rectFrom(drag.current, point(e)));
          }}
          onPointerUp={(e) => {
            if (!drag.current || drag.current.id !== e.pointerId) return;
            const r = rectFrom(drag.current, point(e));
            drag.current = null;
            setLive(null);
            if (r.width >= MIN_DRAG && r.height >= MIN_DRAG) {
              setDraft(null);
              setInputError(null);
              onChange(r);
            }
          }}
          onPointerCancel={() => {
            drag.current = null;
            setLive(null);
          }}
        >
          {shown && shown.width > 0 && shown.height > 0 && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute border-2 border-accent"
              style={{
                left: `${shown.x * 100}%`,
                top: `${shown.y * 100}%`,
                width: `${shown.width * 100}%`,
                height: `${shown.height * 100}%`,
                boxShadow: "0 0 0 9999px rgba(27, 26, 23, 0.35)",
              }}
            />
          )}
        </div>
      </div>
      <p id={helpId} className="text-[12px] leading-4 text-ink-muted">
        Drag across the {wholeLabel.replace(/^Whole /, "")} to select a region, or enter it in percent below. With the selection area focused, arrow keys move the region and
        Shift + arrow keys resize it.
      </p>
      <fieldset className="flex flex-wrap items-end gap-2">
        <legend className="sr-only">Region in percent of the displayed {wholeLabel.replace(/^Whole /, "")}</legend>
        {KEYS.map((k) => (
          <label key={k} className="flex w-[5.5rem] flex-col gap-1 text-[12px] font-medium text-ink-muted">
            {KEY_LABEL[k]} %
            <NumericInput
              value={draft ? draft[k] : value ? pct(value[k]) : ""}
              placeholder={k === "width" || k === "height" ? "100" : "0"}
              onChange={(e) => setDraft({ ...(draft ?? Object.fromEntries(KEYS.map((kk) => [kk, value ? pct(value[kk]) : kk === "width" || kk === "height" ? "100" : "0"])) as Record<Key, string>), [k]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitDraft();
                }
              }}
              aria-invalid={inputError ? true : undefined}
            />
          </label>
        ))}
        <Button size="sm" onClick={commitDraft} disabled={!draft}>
          Apply
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setDraft(null);
            setInputError(null);
            onChange({ x: 0, y: 0, width: 1, height: 1 });
          }}
        >
          {wholeLabel}
        </Button>
        {value && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(null);
              setInputError(null);
              onChange(null);
            }}
          >
            Clear
          </Button>
        )}
      </fieldset>
      {inputError && (
        <p role="alert" className="text-[12px] text-danger">
          {inputError}
        </p>
      )}
    </div>
  );
}
