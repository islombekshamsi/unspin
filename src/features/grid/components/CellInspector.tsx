"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Cell, Column, DataType, DatasetDetail, Locator, MissingReason, Provenance, Row, TransformOperation } from "@/contracts";
import { Badge, Button, ErrorState, Field, Select, TextInput } from "@/components/ui";
import { ConflictNotice } from "@/features/cleaning/components/ConflictNotice";
import { StateText } from "@/features/cleaning/components/TransformPreviewView";
import { useTransformFlow } from "@/features/cleaning/lib/useTransformFlow";
import { MISSING_LABELS, ORIGIN_LABELS, REVIEW_LABELS, TYPE_LABELS, columnUnitTag, valueText } from "../lib/format";

export interface InspectorTarget {
  row: Row;
  column: Column;
  cell: Cell | undefined;
}

const AVAILABILITY_LABELS: Record<Provenance["locatorAvailability"], string> = {
  precise: "Precise location",
  region_only: "Region only",
  page_only: "Page only",
  unavailable: "No source location",
};

function describeLocator(l: Locator): string {
  switch (l.type) {
    case "csv_record":
      return `CSV record ${l.recordIndex + 1}, line${l.lineStart === l.lineEnd ? ` ${l.lineStart}` : `s ${l.lineStart}–${l.lineEnd}`}${l.fieldIndex !== null ? `, field ${l.fieldIndex + 1}` : ""}`;
    case "xlsx_cell":
      return `Sheet “${l.sheetName}”, cell ${l.address}`;
    case "pdf_page":
      return `PDF page ${l.pageNumber}`;
    case "pdf_box":
      return `PDF page ${l.pageNumber}, box in page points`;
    case "image_box":
      return `Image box at ${l.box.left},${l.box.top} (${l.box.width}×${l.box.height} px)`;
    case "figure_label":
      return `Figure “${l.label}”${l.pageNumber ? ` on page ${l.pageNumber}` : ""}`;
    case "user_edit":
      return "Your edit";
    case "derived_operation":
      return "Result of a cleaning operation";
  }
}

export function CellInspector({
  target,
  detail,
  provenanceById,
  editable,
  readOnlyReason,
  editRequest,
  onDetailChange,
  onEditorClosed,
}: {
  target: InspectorTarget | null;
  detail: DatasetDetail;
  provenanceById: Map<string, Provenance>;
  editable: boolean;
  readOnlyReason: string | null;
  /** Increments when the grid asks to open the editor (Enter/F2). */
  editRequest: number;
  onDetailChange: (d: DatasetDetail) => void;
  onEditorClosed: () => void;
}) {
  const [editing, setEditing] = useState<{ cellId: string; request: number } | null>(null);
  const [handledRequest, setHandledRequest] = useState(editRequest);
  const [editVersionId, setEditVersionId] = useState(detail.version.id);
  const cell = target?.cell;

  // Any new version (including the one this editor just saved) closes the editor; the target can
  // be briefly absent while rows reload, so the editor's own "applied" effect may never run.
  if (detail.version.id !== editVersionId) {
    setEditVersionId(detail.version.id);
    setEditing(null);
  }
  // Open the editor when the grid requests it for the active cell (adjusting state during render).
  if (editRequest !== handledRequest) {
    setHandledRequest(editRequest);
    if (editable && cell) setEditing({ cellId: cell.id, request: editRequest });
  }
  const isEditing = !!editing && !!cell && editing.cellId === cell.id;

  const wasEditing = useRef(false);
  const lastVersionId = useRef(detail.version.id);
  useEffect(() => {
    if (lastVersionId.current === detail.version.id) return;
    lastVersionId.current = detail.version.id;
    if (wasEditing.current) onEditorClosed();
  }, [detail.version.id, onEditorClosed]);
  useEffect(() => {
    wasEditing.current = isEditing;
  });

  if (!target) {
    return (
      <div className="p-4 text-[13px] text-ink-muted">
        <p className="font-medium text-ink">No cell selected</p>
        <p className="mt-1">Select a cell to see its original text, typed value, origin, review status, and source reference. Use the arrow keys to move and Enter to edit.</p>
      </div>
    );
  }
  const { row, column } = target;
  const unitTag = columnUnitTag(column);

  return (
    <div className="flex flex-col gap-4 p-4 text-[13px]">
      <header>
        <p className="text-[11px] tracking-wide text-ink-muted uppercase">
          Row {row.sourceOrder + 1} in source · {column.label}
        </p>
        {cell ? (
          <p className="mt-1 text-base break-words text-ink">
            <StateText s={cell} />
          </p>
        ) : (
          <p className="mt-1 text-ink-muted">This row has no cell for this column.</p>
        )}
      </header>

      {cell && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          <dt className="text-ink-muted">Original text</dt>
          <dd className="font-mono text-[12px] break-words whitespace-pre-wrap">{cell.rawText === null ? <em className="font-sans text-ink-muted">none in source</em> : JSON.stringify(cell.rawText)}</dd>
          <dt className="text-ink-muted">Current value</dt>
          <dd className="font-mono text-[12px] break-words">{cell.currentValue === null ? <em className="font-sans text-ink-muted">missing — {MISSING_LABELS[cell.missingReason!]}</em> : JSON.stringify(valueText(cell.currentValue))}</dd>
          <dt className="text-ink-muted">Type</dt>
          <dd>
            {TYPE_LABELS[cell.valueType]}
            {column.dataType !== cell.valueType && <span className="text-ink-muted"> (column: {TYPE_LABELS[column.dataType]})</span>}
          </dd>
          <dt className="text-ink-muted">Unit</dt>
          <dd>{unitTag ?? <span className="text-ink-muted">not set</span>}</dd>
          {column.datePolicy && (
            <>
              <dt className="text-ink-muted">Date policy</dt>
              <dd>
                {column.datePolicy.format}, {column.datePolicy.timezone === "utc" ? "UTC instants" : "calendar dates (no time zone)"}
              </dd>
            </>
          )}
          <dt className="text-ink-muted">Origin</dt>
          <dd className="flex flex-wrap items-center gap-1">
            {ORIGIN_LABELS[cell.origin]}
            {cell.origin === "estimated" && <Badge tone="estimate">Estimate</Badge>}
          </dd>
          <dt className="text-ink-muted">Review</dt>
          <dd>{REVIEW_LABELS[cell.reviewStatus]}</dd>
        </dl>
      )}

      {cell && cell.notes.length > 0 && (
        <section aria-label="Notes">
          <h3 className="text-[12px] font-semibold text-ink-muted">Notes</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {cell.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}

      {cell && (
        <section aria-label="Provenance">
          <h3 className="text-[12px] font-semibold text-ink-muted">Where this value comes from</h3>
          {cell.provenanceIds.length === 0 && <p className="mt-1 text-ink-muted">No provenance recorded.</p>}
          <ol className="mt-1 flex flex-col gap-1.5">
            {cell.provenanceIds.map((id) => {
              const p = provenanceById.get(id);
              if (!p) return (
                <li key={id} className="text-ink-muted">
                  Reference not available in this view.
                </li>
              );
              return (
                <li key={id} className="rounded-md border border-rule px-2 py-1.5">
                  <p className="flex flex-wrap items-center gap-1">
                    <span className="font-medium">{describeLocator(p.locator)}</span>
                    {p.locatorOrigin === "model_hint" && (
                      <Badge tone="estimate" title="Proposed by the model; not verified against the source">
                        Unverified hint
                      </Badge>
                    )}
                    {p.locatorOrigin === "user_confirmed" && <Badge tone="success">Confirmed by you</Badge>}
                  </p>
                  <p className="text-[12px] text-ink-muted">
                    {AVAILABILITY_LABELS[p.locatorAvailability]} · {p.label}
                  </p>
                </li>
              );
            })}
          </ol>
          {cell.parentCellIds.length > 0 && (
            <p className="mt-1 text-[12px] text-ink-muted">Derived from {cell.parentCellIds.length} other cell{cell.parentCellIds.length === 1 ? "" : "s"}; their origin is unchanged by reviewing this one.</p>
          )}
        </section>
      )}

      {!editable && readOnlyReason && <p className="rounded-md border border-dashed border-rule-strong bg-sunken px-3 py-2 text-ink-muted">{readOnlyReason}</p>}

      {editable && cell && !isEditing && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={() => setEditing({ cellId: cell.id, request: -1 })}>
            Edit value
          </Button>
          <ReviewAction key={`${detail.version.id}:${cell.id}`} detail={detail} cell={cell} onDetailChange={onDetailChange} />
        </div>
      )}

      {editable && cell && isEditing && (
        <CellEditor
          key={cell.id}
          detail={detail}
          row={row}
          column={column}
          cell={cell}
          onDetailChange={onDetailChange}
          onClose={() => {
            setEditing(null);
            onEditorClosed();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor: explicit preview -> Save
// ---------------------------------------------------------------------------

const EDIT_TYPES: DataType[] = ["text", "decimal", "date", "datetime", "boolean"];

function CellEditor({
  detail,
  row,
  column,
  cell,
  onDetailChange,
  onClose,
}: {
  detail: DatasetDetail;
  row: Row;
  column: Column;
  cell: Cell;
  onDetailChange: (d: DatasetDetail) => void;
  onClose: () => void;
}) {
  const initialType: DataType = cell.valueType === "unknown" ? (column.dataType === "unknown" ? "text" : column.dataType) : cell.valueType;
  const [type, setType] = useState<DataType>(initialType);
  const [value, setValue] = useState(cell.currentValue === null ? "" : valueText(cell.currentValue));
  const [missing, setMissing] = useState(cell.currentValue === null);
  const [reason, setReason] = useState<MissingReason>(cell.missingReason ?? "not_reported");
  const [note, setNote] = useState("");
  const flow = useTransformFlow(detail, onDetailChange);
  const formRef = useRef<HTMLFormElement>(null);
  const formId = useId();

  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input:not([type=checkbox]), select")?.focus();
  }, []);

  useEffect(() => {
    if (flow.state.status === "applied") onClose();
  }, [flow.state.status, onClose]);

  const operation = (): TransformOperation => ({
    type: "edit_cell",
    rowId: row.id,
    columnId: column.id,
    cellId: cell.id,
    newValue: missing ? null : type === "boolean" ? value === "true" : type === "decimal" ? value.trim() : value,
    explicitType: type,
    missingReason: missing ? reason : null,
    note: note.trim() || null,
  });

  const { state } = flow;
  const preview = state.status === "ready" || state.status === "applying" ? state.preview : null;
  const change = preview?.changes[0] ?? null;
  const dirty = state.status === "idle" || state.status === "failed";

  return (
    <form
      ref={formRef}
      id={formId}
      aria-label="Edit cell"
      className="flex flex-col gap-3 rounded-md border border-accent/40 bg-accent-soft/40 p-3"
      onKeyDown={(e) => {
        if (e.key === "Escape" && state.status !== "applying") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      onSubmit={(e) => {
        e.preventDefault();
        if (state.status === "ready") void flow.apply();
        else if (state.status !== "applying" && state.status !== "previewing") void flow.preview(operation());
      }}
    >
      <p className="text-[12px] font-semibold text-ink">Edit value · original text is kept</p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={missing}
          onChange={(e) => {
            setMissing(e.target.checked);
            flow.reset();
          }}
        />
        Mark as missing (not zero)
      </label>
      {missing ? (
        <Field label="Reason">
          {(id) => (
            <Select
              id={id}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value as MissingReason);
                flow.reset();
              }}
            >
              {(Object.keys(MISSING_LABELS) as MissingReason[]).map((r) => (
                <option key={r} value={r}>
                  {MISSING_LABELS[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : (
        <>
          <Field label="Type">
            {(id) => (
              <Select
                id={id}
                value={type}
                onChange={(e) => {
                  setType(e.target.value as DataType);
                  flow.reset();
                }}
              >
                {EDIT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Value"
            hint={
              type === "decimal"
                ? "Exact digits, “.” as decimal point, no grouping or symbols, e.g. -1234.50"
                : type === "date"
                  ? "YYYY-MM-DD"
                  : type === "datetime"
                    ? "UTC, e.g. 2026-01-31T12:00:00.000Z"
                    : undefined
            }
          >
            {(id) =>
              type === "boolean" ? (
                <Select
                  id={id}
                  value={value === "true" ? "true" : "false"}
                  onChange={(e) => {
                    setValue(e.target.value);
                    flow.reset();
                  }}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </Select>
              ) : (
                <TextInput
                  id={id}
                  value={value}
                  inputMode={type === "decimal" ? "decimal" : undefined}
                  className={type === "decimal" ? "tabular" : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => {
                    setValue(e.target.value);
                    flow.reset();
                  }}
                />
              )
            }
          </Field>
        </>
      )}
      <Field label="Note (optional)">
        {(id) => (
          <TextInput
            id={id}
            value={note}
            maxLength={1000}
            placeholder="Why this change, e.g. checked against page 4"
            onChange={(e) => {
              setNote(e.target.value);
              flow.reset();
            }}
          />
        )}
      </Field>

      {change && (
        <div className="rounded-md border border-rule bg-surface px-2 py-1.5" role="status">
          <p className="text-[12px] text-ink-muted">Before → after</p>
          <p>
            <StateText s={change.before} /> → <StateText s={change.after} />
          </p>
          {preview!.warnings.map((w) => (
            <p key={w} className="mt-1 text-[12px] text-estimate">
              {w}
            </p>
          ))}
        </div>
      )}
      {preview && !change && <p className="text-[12px] text-ink-muted">{preview.affectedCount > 0 ? "Only the note changes." : "This is the same as the current value."}</p>}
      {state.status === "failed" && (
        <ErrorState
          title={state.phase === "apply" ? "Not saved" : "Check the value"}
          message={state.error.code === "preview_required" ? "The change differs from the preview. Preview it again." : state.error.message}
          code={state.error.code}
        />
      )}
      {state.status === "conflict" && <ConflictNotice datasetId={detail.dataset.id} onDetailChange={onDetailChange} />}

      <div className="flex flex-wrap gap-2">
        {dirty || state.status === "previewing" || state.status === "conflict" ? (
          <Button type="submit" size="sm" variant="primary" loading={state.status === "previewing"} disabled={state.status === "conflict"}>
            Preview change
          </Button>
        ) : (
          <Button type="submit" size="sm" variant="primary" loading={state.status === "applying"} disabled={!preview || preview.affectedCount === 0}>
            {state.status === "applying" ? "Saving…" : "Save"}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClose} disabled={state.status === "applying"}>
          Cancel
        </Button>
      </div>
      <p className="text-[11px] text-ink-faint" aria-live="polite">
        {state.status === "ready" ? "Previewed, not saved yet. Press Save to create a new version." : state.status === "applying" ? "Saving…" : "Unsaved edit. Escape cancels."}
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Mark reviewed: preview -> confirm
// ---------------------------------------------------------------------------

function ReviewAction({ detail, cell, onDetailChange }: { detail: DatasetDetail; cell: Cell; onDetailChange: (d: DatasetDetail) => void }) {
  const flow = useTransformFlow(detail, onDetailChange);
  const { state } = flow;
  if (cell.reviewStatus === "accepted") {
    return <span className="self-center text-[12px] text-ink-muted">✓ Reviewed by you</span>;
  }
  const op: TransformOperation = { type: "set_review_status", cellIds: [cell.id], reviewStatus: "accepted" };
  if (state.status === "idle" || state.status === "previewing") {
    return (
      <Button size="sm" loading={state.status === "previewing"} onClick={() => void flow.preview(op)}>
        Mark reviewed
      </Button>
    );
  }
  if (state.status === "conflict") return <ConflictNotice className="w-full" datasetId={detail.dataset.id} onDetailChange={onDetailChange} onDismiss={flow.reset} />;
  if (state.status === "failed") {
    return <ErrorState className="w-full" title="Not saved" message={state.error.message} code={state.error.code} action={<Button size="sm" onClick={flow.reset}>Dismiss</Button>} />;
  }
  if (state.status === "applied") return <span className="self-center text-[12px] text-ink-muted">Saved</span>;
  return (
    <div className="w-full rounded-md border border-rule bg-surface px-2 py-1.5" role="status">
      <p>Record that you checked this value against the source?</p>
      {state.preview.precisionEffects.map((p) => (
        <p key={p} className="text-[12px] text-ink-muted">
          {p}
        </p>
      ))}
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="primary" loading={state.status === "applying"} onClick={() => void flow.apply()}>
          {state.status === "applying" ? "Saving…" : "Confirm reviewed"}
        </Button>
        <Button size="sm" variant="ghost" onClick={flow.reset} disabled={state.status === "applying"}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
