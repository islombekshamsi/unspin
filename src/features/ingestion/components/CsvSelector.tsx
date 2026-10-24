"use client";

import { useEffect, useMemo, useState } from "react";
import type { CsvDelimiter, Source, StructuredInspection } from "@/contracts";
import { Badge, Button, ErrorState, NumericInput, SegmentedControl, Select } from "@/components/ui";
import { ApiClientError, api } from "@/lib/api/client";
import { DELIMITER_NAMES, suggestHeader } from "@/server/ingestion/csv-tokenizer";
import { plural } from "../lib/format";
import { useLimits } from "../lib/use-limits";
import { SelectionFooter, type SubmitState } from "./SourceSelector";

type CsvInspection = Extract<StructuredInspection, { kind: "csv" }>;
const PREVIEW_DATA_ROWS = 20;

export function CsvSelector({ source, state }: { source: Source; state: SubmitState }) {
  const limits = useLimits();
  const [delimiter, setDelimiter] = useState<CsvDelimiter | null>(null);
  const [result, setResult] = useState<{ key: string; inspection: CsvInspection | null; error: ApiClientError | null } | null>(null);
  const [header, setHeader] = useState<0 | 1 | null>(null);
  const [columns, setColumns] = useState<Set<number> | null>(null);
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const key = `${source.id}:${delimiter ?? "auto"}`;

  useEffect(() => {
    let cancelled = false;
    api.inspectSource(source.id, delimiter ? { delimiter } : {}).then(
      (inspection) => {
        if (cancelled) return;
        if (inspection.kind !== "csv") return setResult({ key, inspection: null, error: new ApiClientError("internal", "Unexpected preview type.", 0, false, null, undefined) });
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
  }, [source.id, delimiter, key]);

  const current = result?.key === key ? result : null;
  const ins = current?.inspection ?? null;
  const headerCount = header ?? ins?.suggestedHeaderRecordCount ?? 1;
  const headerReason = useMemo(() => (ins ? suggestHeader(ins.previewRecords.map((fields, i) => ({ fields, lineStart: i + 1, lineEnd: i + 1 }))).reason : ""), [ins]);
  const dataRecords = ins ? Math.max(0, ins.totalRecords - headerCount) : 0;
  const maxRows = limits?.maxStructuredRows ?? Infinity;
  const maxCols = limits?.maxColumns ?? Infinity;

  const start = startText.trim() === "" ? 1 : Number(startText);
  const end = endText.trim() === "" ? dataRecords : Number(endText);
  const intervalValid = Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start && end <= dataRecords;
  const selectedRows = intervalValid ? end - start + 1 : 0;
  const allColumns = ins ? Array.from({ length: ins.maxFieldCount }, (_, i) => i) : [];
  const chosen = columns ?? new Set(allColumns);
  const labelFor = (c: number) => {
    const h = headerCount === 1 ? ins?.previewRecords[0]?.[c] : undefined;
    return h && h.trim() !== "" ? h : `Column ${c + 1}`;
  };

  let blocker: string | undefined;
  if (!ins) blocker = "Waiting for the preview.";
  else if (dataRecords === 0) blocker = "There are no data records to import.";
  else if (!intervalValid) blocker = `Enter a record range between 1 and ${dataRecords.toLocaleString()}.`;
  else if (selectedRows > maxRows) blocker = `Choose at most ${maxRows.toLocaleString()} records (currently ${selectedRows.toLocaleString()}).`;
  else if (chosen.size === 0) blocker = "Select at least one column.";
  else if (chosen.size > maxCols) blocker = `Choose at most ${maxCols} columns (currently ${chosen.size}).`;

  const submit = () => {
    if (!ins || blocker) return;
    const fullRange = start === 1 && end === dataRecords;
    void state.submit({
      kind: "csv_records",
      delimiter: ins.delimiterUsed,
      headerRecordCount: headerCount,
      selectedColumnIndexes: columns && chosen.size !== allColumns.length ? [...chosen].sort((a, b) => a - b) : null,
      recordInterval: fullRange ? null : { start: start - 1, endExclusive: end },
    });
  };

  const previewData = ins ? ins.previewRecords.slice(headerCount, headerCount + PREVIEW_DATA_ROWS) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-muted">
          Delimiter
          <Select
            className="w-44"
            value={delimiter ?? ins?.delimiterUsed ?? ","}
            onChange={(e) => {
              setDelimiter(e.target.value as CsvDelimiter);
              setColumns(null);
            }}
          >
            {(Object.keys(DELIMITER_NAMES) as CsvDelimiter[]).map((d) => (
              <option key={d} value={d}>
                {DELIMITER_NAMES[d]}
                {ins?.suggestedDelimiter === d ? " (suggested)" : ""}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-ink-muted" id="csv-header-label">
            First record
          </span>
          <SegmentedControl<"1" | "0">
            label="First record"
            value={String(headerCount) as "1" | "0"}
            onChange={(v) => setHeader(v === "1" ? 1 : 0)}
            options={[
              { value: "1", label: "Is a header" },
              { value: "0", label: "Is data" },
            ]}
          />
        </div>
        {ins && (
          <p className="pb-1 text-[12px] text-ink-muted">
            {plural(ins.totalRecords, "record")} · {plural(ins.maxFieldCount, "column")}
            {ins.hasBom ? " · UTF-8 with byte-order mark" : " · UTF-8"}
          </p>
        )}
      </div>
      {ins && (
        <p className="text-[12px] text-ink-muted">
          Suggested: {DELIMITER_NAMES[ins.suggestedDelimiter].toLowerCase()}, {ins.suggestedHeaderRecordCount ? "first record as header" : "no header"}. {headerReason}
        </p>
      )}

      {current?.error && <ErrorState title="Preview unavailable" message={current.error.message} code={current.error.code} requestId={current.error.requestId ?? undefined} />}
      {!current && (
        <p className="text-[13px] text-ink-muted" role="status">
          Reading the file…
        </p>
      )}

      {ins && ins.inconsistentRecords.length > 0 && (
        <div className="rounded-md border border-estimate-rule bg-estimate-soft px-3 py-2 text-[13px] text-ink" role="note">
          <p className="font-medium text-estimate">
            <span aria-hidden="true">⚠ </span>
            {plural(ins.inconsistentRecords.length, "record")} with a different number of fields
          </p>
          <p className="mt-0.5 text-ink-muted">They are kept. Missing fields become empty cells marked “not reported”; extra fields become extra columns. Nothing is dropped.</p>
          <ul className="tabular mt-1 flex flex-wrap gap-x-3 text-[12px] text-ink-muted">
            {ins.inconsistentRecords.slice(0, 12).map((r) => (
              <li key={r.recordIndex}>
                record {r.recordIndex + 1}: {plural(r.fieldCount, "field")}
              </li>
            ))}
            {ins.inconsistentRecords.length > 12 && <li>…and {ins.inconsistentRecords.length - 12} more</li>}
          </ul>
        </div>
      )}
      {ins && ins.issues.length > 0 && (
        <ul className="flex flex-col gap-1 text-[12px] text-ink-muted">
          {ins.issues
            .filter((i) => !/do not have \d+ fields/.test(i))
            .map((i) => (
              <li key={i}>• {i}</li>
            ))}
        </ul>
      )}

      {ins && (
        <div className="overflow-auto rounded-md border border-rule" style={{ maxHeight: "24rem" }}>
          <table className="w-max min-w-full border-collapse text-[12px]">
            <caption className="sr-only">Preview of the first {previewData.length} data records as written in the file</caption>
            <thead className="sticky top-0 bg-sunken">
              <tr>
                <th scope="col" className="border-b border-rule px-2 py-1.5 text-left font-medium text-ink-faint">
                  #
                </th>
                {allColumns.map((c) => (
                  <th key={c} scope="col" className="border-b border-l border-rule px-2 py-1.5 text-left align-top font-medium text-ink">
                    <label className="flex items-start gap-1.5">
                      <input
                        type="checkbox"
                        checked={chosen.has(c)}
                        onChange={(e) => {
                          const next = new Set(chosen);
                          if (e.target.checked) next.add(c);
                          else next.delete(c);
                          setColumns(next);
                        }}
                        className="mt-0.5 accent-[var(--accent)]"
                      />
                      <span className={`max-w-48 truncate ${chosen.has(c) ? "" : "text-ink-faint line-through"}`} title={labelFor(c)}>
                        {labelFor(c)}
                      </span>
                    </label>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewData.map((rec, i) => (
                <tr key={i} className="odd:bg-surface even:bg-canvas">
                  <th scope="row" className="tabular px-2 py-1 text-left font-normal text-ink-faint">
                    {i + 1}
                  </th>
                  {allColumns.map((c) => {
                    const v = rec[c];
                    return (
                      <td key={c} className={`max-w-56 truncate border-l border-rule px-2 py-1 whitespace-pre ${chosen.has(c) ? "text-ink" : "text-ink-faint"}`} title={v}>
                        {v === undefined ? <span className="text-ink-faint italic">no field</span> : v === "" ? <span className="text-ink-faint">·</span> : v}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ins && (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
          <span>
            Showing the first {previewData.length} of {plural(dataRecords, "data record")}. Raw text is shown exactly; “·” marks an empty field.
          </span>
          {columns && (
            <Button size="sm" variant="ghost" onClick={() => setColumns(null)}>
              Select all columns
            </Button>
          )}
        </div>
      )}

      {ins && dataRecords > 0 && (
        <fieldset className="flex flex-wrap items-end gap-2">
          <legend className="mb-1 text-[12px] font-medium text-ink-muted">
            Records to import <span className="font-normal">(data records, 1–{dataRecords.toLocaleString()}; leave empty for all)</span>
          </legend>
          <label className="flex flex-col gap-1 text-[12px] text-ink-muted">
            From
            <NumericInput className="w-28" value={startText} placeholder="1" onChange={(e) => setStartText(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-ink-muted">
            To
            <NumericInput className="w-28" value={endText} placeholder={String(dataRecords)} onChange={(e) => setEndText(e.target.value)} />
          </label>
          {dataRecords > maxRows && (
            <Badge tone="estimate" className="mb-2">
              Over the {maxRows.toLocaleString()}-record limit: choose a range
            </Badge>
          )}
        </fieldset>
      )}

      <SelectionFooter
        scope={
          ins && intervalValid
            ? `${plural(selectedRows, "record")} × ${plural(chosen.size, "column")} will be imported exactly as written.`
            : "Choose records and columns to import."
        }
        disclosure="Parsed on this server. Nothing is sent to an AI model. Dates, percentages, currencies, and identifiers are not converted."
        canSubmit={!blocker && !state.submitting}
        disabledReason={blocker}
        onSubmit={submit}
        state={state}
      />
    </div>
  );
}
