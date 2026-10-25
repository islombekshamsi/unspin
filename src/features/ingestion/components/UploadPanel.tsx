"use client";

import { useRef, useState } from "react";
import { Button, ErrorState, Select } from "@/components/ui";
import type { DemoMode } from "@/contracts";
import { initializePreparedChart } from "@/features/workspace/lib/prepared-chart";
import type { UploadPanelProps } from "@/features/workspace/seams";
import { ApiClientError, api } from "@/lib/api/client";
import { formatBytes } from "../lib/format";
import { ChipDropzone, type FileChip } from "./ChipDropzone";

const ACCEPT = [".csv", ".xlsx", ".pdf", ".png", ".jpg", ".jpeg", ".webp", "text/csv", "application/pdf", "image/png", "image/jpeg", "image/webp", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"].join(",");

interface UploadError {
  chipId: string;
  title: string;
  message: string;
  code?: string;
  requestId?: string;
}

/** Small files are checked in milliseconds; keep each chip state on screen long enough to read. */
const MIN_CHECKING_MS = 500;
const CONFIRM_HOLD_MS = 900;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let chipCounter = 0;
const nextChipId = () => `chip-${++chipCounter}`;

export function UploadPanel({ limits, onSourceCreated, onDemoReady }: UploadPanelProps) {
  const [mode, setMode] = useState<DemoMode | "live">("live");
  const [chips, setChips] = useState<FileChip[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<UploadError | null>(null);
  const controller = useRef<AbortController | null>(null);

  const patch = (id: string, next: Partial<FileChip>) =>
    setChips((all) => all.map((chip) => (chip.id === id ? { ...chip, ...next } : chip)));

  const refuse = (chip: FileChip, err: Omit<UploadError, "chipId">) => {
    patch(chip.id, { status: "refused", note: err.title });
    setError({ chipId: chip.id, ...err });
  };

  const start = async (chip: FileChip) => {
    if (busyId) return;
    const { file } = chip;
    if (limits && file.size > limits.maxUploadBytes) {
      refuse(chip, {
        title: `${file.name} is too large`,
        message: `It is ${formatBytes(file.size)}; files are limited to ${formatBytes(limits.maxUploadBytes)}.`,
        code: "payload_too_large",
      });
      return;
    }
    if (file.size === 0) {
      refuse(chip, { title: `${file.name} is empty`, message: "Choose a file that contains data." });
      return;
    }
    const ac = new AbortController();
    controller.current = ac;
    setBusyId(chip.id);
    patch(chip.id, { status: "checking", note: undefined });
    setError(null);
    try {
      const [source] = await Promise.all([api.uploadSource(file, ac.signal), wait(MIN_CHECKING_MS)]);
      const prepared = mode !== "live" ? await api.prepareDemo(source.id, mode) : null;
      prepared?.datasets.forEach(initializePreparedChart);
      controller.current = null;
      patch(chip.id, { status: "confirmed" });
      await wait(CONFIRM_HOLD_MS);
      onSourceCreated(source);
      if (prepared?.datasets[0]) onDemoReady?.(prepared.datasets[0].id);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        patch(chip.id, { status: "cancelled" });
      } else if (e instanceof ApiClientError) {
        refuse(chip, { title: `${file.name} could not be used`, message: e.message, code: e.code, requestId: e.requestId ?? undefined });
      } else {
        refuse(chip, { title: "Upload failed", message: "Something went wrong while uploading. Try again." });
      }
    } finally {
      controller.current = null;
      setBusyId(null);
    }
  };

  const addFiles = (files: File[]) => {
    const added = files.map<FileChip>((file) => ({ id: nextChipId(), file, status: "waiting" }));
    setChips((all) => [...all, ...added]);
    const [only] = added;
    if (added.length === 1 && only && !busyId) void start(only);
  };

  const remove = (id: string) => {
    setChips((all) => all.filter((chip) => chip.id !== id));
    if (error?.chipId === id) setError(null);
  };

  const waiting = chips.filter((chip) => chip.status === "waiting").length;

  return (
    <section aria-label="Upload a source file" className="flex h-full flex-col gap-3">
      <div className="rounded-[22px] border border-rule bg-surface p-4">
        <label htmlFor="import-demo-mode" className="mb-2 block text-sm font-medium text-ink">Import mode</label>
        <Select id="import-demo-mode" value={mode} disabled={busyId !== null} onChange={(e) => setMode(e.target.value as DemoMode | "live")}>
          <option value="live">Live import · any supported file</option>
          <option value="finance">Finance</option>
          <option value="academic">Academic</option>
          <option value="research">Research</option>
        </Select>
      </div>
      <ChipDropzone
        accept={ACCEPT}
        busy={busyId !== null}
        chips={chips}
        onFiles={addFiles}
        onOpen={(id) => {
          const chip = chips.find((c) => c.id === id);
          if (chip) void start(chip);
        }}
        onRemove={remove}
        onCancel={() => controller.current?.abort()}
        footer={
          <>
            {limits ? limits.acceptedKinds.join(" · ") : "PNG · JPEG · WebP · PDF · CSV · XLSX"}
            {limits ? ` · up to ${formatBytes(limits.maxUploadBytes)}` : ""}
          </>
        }
      />
      {waiting > 1 && !busyId && (
        <p className="text-[13px] text-ink-muted" role="status">
          {waiting} files are waiting. UNSPIN opens one file at a time, so choose Open on the one you want.
        </p>
      )}
      {error && (
        <ErrorState
          title={error.title}
          message={error.message}
          code={error.code}
          requestId={error.requestId}
          action={
            <Button size="sm" variant="ghost" onClick={() => setError(null)}>
              Dismiss
            </Button>
          }
        />
      )}
    </section>
  );
}
