"use client";

import { useEffect, useState } from "react";
import type { Source, StructuredInspection } from "@/contracts";
import { Badge, ErrorState, SegmentedControl, TextInput } from "@/components/ui";
import { ApiClientError, api } from "@/lib/api/client";
import { columnLetter, formatRange, parseRange } from "@/server/ingestion/a1";
import { plural } from "../lib/format";
import { useLimits } from "../lib/use-limits";
import { SelectionFooter, type SubmitState } from "./SourceSelector";

type XlsxInspection = Extract<StructuredInspection, { kind: "xlsx" }>;
const STATE_LABEL = { visible: null, hidden: "hidden", veryHidden: "very hidden" } as const;

export function XlsxSelector({ source, state }: { source: Source; state: SubmitState }) {
  const limits = useLimits();
  const [sheet, setSheet] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; inspection: XlsxInspection | null; error: ApiClientError | null } | null>(null);
  const [rangeText, setRangeText] = useState<string | null>(null);
  const [header, setHeader] = useState<0 | 1>(1);
  const key = `${source.id}:${sheet ?? "auto"}`;

  useEffect(() => {
    let cancelled = false;
    api.inspectSource(source.id, sheet ? { sheetName: sheet } : {}).then(
      (inspection) => {
        if (cancelled) return;
        if (inspection.kind !== "xlsx") return setResult({ key, inspection: null, error: new ApiClientError("internal", "Unexpected preview type.", 0, false, null, undefined) });
        setResult({ key, inspection, error: null });
      },
      (e: unknown) => {
        if (cancelled) return;
        setResult({ key, inspection: null, error: e instanceof ApiClientError ? e : new ApiClientError("internal", "The preview could not be loaded.", 0, true, null, undefined) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source.id, sheet, key]);

  const current = result?.key === key ? result : null;
  const ins = current?.inspection ?? null;
  const activeSheet = ins?.sheets.find((s) => s.name === ins.sheetUsed) ?? null;
  const used = activeSheet?.usedRange ? parseRange(activeSheet.usedRange) : null;
  const rangeValue = rangeText ?? activeSheet?.usedRange ?? "";
  const parsed = rangeValue.trim() ? parseRange(rangeValue) : null;
  const rows = parsed ? parsed.bottom - parsed.top + 1 - header : 0;
  const cols = parsed ? parsed.right - parsed.left + 1 : 0;

  let blocker: string | undefined;
  if (!ins || !activeSheet) blocker = "Waiting for the workbook preview.";
  else if (!activeSheet.usedRange) blocker = "This sheet has no values.";
  else if (!parsed) blocker = "Enter a range such as A1:F40.";
  else if (rows <= 0) blocker = "The range needs at least one data row below the header.";
  else if (limits && cols > limits.maxColumns) blocker = `Choose at most ${limits.maxColumns} columns (currently ${cols}).`;
  else if (limits && rows > limits.maxStructuredRows) blocker = `Choose at most ${limits.maxStructuredRows.toLocaleString()} data rows (currently ${rows.toLocaleString()}).`;

  return (
    <div className="flex flex-col gap-4">
      {current?.error && <ErrorState title="Preview unavailable" message={current.error.message} code={current.error.code} requestId={current.error.requestId ?? undefined} />}
      {!current && (
        <p className="text-[13px] text-ink-muted" role="status">
          Reading the workbook…
        </p>
      )}
      {ins && (
        <fieldset>
          <legend className="mb-1.5 text-[12px] font-medium text-ink-muted">Sheet</legend>
          <div className="flex flex-wrap gap-2">
            {ins.sheets.map((s) => {
              const checked = s.name === ins.sheetUsed;
              return (
                <label
                  key={s.name}
                  className={`flex cursor-pointer flex-col gap-0.5 rounded-md border px-3 py-2 text-[13px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus)] ${checked ? "border-accent bg-accent-soft" : "border-rule-strong bg-surface hover:bg-sunken"}`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`sheet-${source.id}`}
                      className="sr-only"
                      checked={checked}
                      onChange={() => {
                        setSheet(s.name);
                        setRangeText(null);
                      }}
                    />
                    <span className="font-medium text-ink">{s.name}</span>
                    {STATE_LABEL[s.state] && <Badge>{STATE_LABEL[s.state]}</Badge>}
                  </span>
                  <span className="tabular text-[11px] text-ink-muted">
                    {s.usedRange ? `${s.usedRange} · ${plural(s.rowCount, "row")}` : "empty"}
                    {s.mergedRanges.length ? ` · ${plural(s.mergedRanges.length, "merge")}` : ""}
                    {s.formulaCellCount ? ` · ${plural(s.formulaCellCount, "formula", "formulas")}` : ""}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {ins && activeSheet?.usedRange && (
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-muted">
            Cell range
            <TextInput
              className="w-40 font-mono"
              value={rangeValue}
              onChange={(e) => setRangeText(e.target.value.toUpperCase())}
              aria-invalid={!parsed || undefined}
              spellCheck={false}
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-ink-muted">First row of the range</span>
            <SegmentedControl<"1" | "0">
              label="First row of the range"
              value={String(header) as "1" | "0"}
              onChange={(v) => setHeader(v === "1" ? 1 : 0)}
              options={[
                { value: "1", label: "Is a header" },
                { value: "0", label: "Is data" },
              ]}
            />
          </div>
          {parsed && (
            <p className="tabular pb-2 text-[12px] text-ink-muted">
              {formatRange(parsed)} · {plural(Math.max(rows, 0), "data row")} × {plural(cols, "column")}
            </p>
          )}
        </div>
      )}

      {ins && ins.issues.length > 0 && (
        <div className="rounded-md border border-estimate-rule bg-estimate-soft px-3 py-2 text-[13px]" role="note">
          <p className="font-medium text-estimate">
            <span aria-hidden="true">⚠ </span>Check before importing
          </p>
          <ul className="mt-1 flex flex-col gap-0.5 text-[12px] text-ink">
            {ins.issues.map((i) => (
              <li key={i}>• {i}</li>
            ))}
          </ul>
        </div>
      )}

      {ins && used && ins.previewRows.length > 0 && (
        <div className="overflow-auto rounded-md border border-rule" style={{ maxHeight: "24rem" }}>
          <table className="w-max min-w-full border-collapse font-mono text-[12px]">
            <caption className="sr-only">
              Preview of sheet {ins.sheetUsed} starting at {columnLetter(used.left)}
              {used.top}; values as stored, without number formats
            </caption>
            <thead className="sticky top-0 bg-sunken">
              <tr>
                <th scope="col" className="border-b border-rule px-2 py-1" />
                {ins.previewRows[0].map((_, i) => (
                  <th key={i} scope="col" className="border-b border-l border-rule px-2 py-1 text-center font-medium text-ink-muted">
                    {columnLetter(used.left + i)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ins.previewRows.map((row, ri) => {
                const r = used.top + ri;
                const inRange = parsed && r >= parsed.top && r <= parsed.bottom;
                const isHeader = parsed && header === 1 && r === parsed.top;
                return (
                  <tr key={ri} className={isHeader ? "bg-accent-soft font-semibold" : ""}>
                    <th scope="row" className="tabular border-r border-rule bg-sunken px-2 py-1 text-right font-normal text-ink-muted">
                      {r}
                    </th>
                    {row.map((v, ci) => {
                      const c = used.left + ci;
                      const inside = inRange && parsed && c >= parsed.left && c <= parsed.right;
                      return (
                        <td key={ci} className={`max-w-48 truncate border-l border-rule px-2 py-1 font-sans ${inside ? "text-ink" : "bg-canvas text-ink-faint"}`} title={v ?? undefined}>
                          {v ?? ""}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {ins && used && (
        <p className="text-[12px] text-ink-muted">
          Showing the first {ins.previewRows.length} rows. Cells outside the chosen range are dimmed. Values are shown as stored in the file; number formats are not applied.
        </p>
      )}

      <SelectionFooter
        scope={parsed && rows > 0 ? `Only ${ins?.sheetUsed ?? "this sheet"}!${formatRange(parsed)} is imported (${plural(rows, "row")} × ${plural(cols, "column")}).` : "Choose a sheet and a cell range."}
        disclosure="Parsed on this server. Nothing is sent to an AI model. Formulas and macros are never run; saved formula results are marked as cached."
        canSubmit={!blocker && !state.submitting}
        disabledReason={blocker}
        onSubmit={() =>
          ins?.sheetUsed && parsed && void state.submit({ kind: "xlsx_range", sheetName: ins.sheetUsed, range: formatRange(parsed), headerRowCount: header })
        }
        state={state}
      />
    </div>
  );
}
