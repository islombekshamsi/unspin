"use client";

import { useEffect, useMemo, useState } from "react";
import type { Provenance, StructuredInspection } from "@/contracts";
import { Badge, ErrorState } from "@/components/ui";
import type { SourceViewerProps } from "@/features/workspace/seams";
import { api } from "@/lib/api/client";
import { columnLetter, parseAddress, parseRange } from "@/server/ingestion/a1";
import { decodeUtf8Text, DELIMITER_NAMES, tokenizeCsv, type CsvTokens } from "@/server/ingestion/csv-tokenizer";

const MAX_RECORDS_SHOWN = 8;

/** Record/cell view for CSV and XLSX sources, showing the exact locator of linked values. */
export function StructuredRecordView(props: SourceViewerProps) {
  return props.source.kind === "csv" ? <CsvRecords {...props} /> : <XlsxCells {...props} />;
}

function useActive(provenance: Provenance[], ids: string[]): Provenance[] {
  const key = ids.join(",");
  return useMemo(() => {
    if (ids.length === 0) return [];
    const set = new Set(ids);
    return provenance.filter((p) => set.has(p.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provenance, key]);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function useCsvTokens(url: string, delimiter: string | null): { tokens: CsvTokens | null; error: string | null } {
  const [state, setState] = useState<{ key: string; tokens: CsvTokens | null; error: string | null } | null>(null);
  const key = `${url}|${delimiter}`;
  useEffect(() => {
    if (!delimiter) return;
    const ac = new AbortController();
    fetch(url, { credentials: "same-origin", cache: "no-store", signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "The stored file is no longer available." : `The file could not be loaded (${res.status}).`);
        const decoded = decodeUtf8Text(new Uint8Array(await res.arrayBuffer()));
        if ("error" in decoded) throw new Error("The file could not be decoded as UTF-8 text.");
        return tokenizeCsv(decoded.text, delimiter);
      })
      .then(
        (tokens) => setState({ key, tokens, error: null }),
        (e: unknown) => {
          if (!ac.signal.aborted) setState({ key, tokens: null, error: e instanceof Error ? e.message : "The file could not be read." });
        },
      );
    return () => ac.abort();
  }, [url, delimiter, key]);
  const current = state?.key === key ? state : null;
  return { tokens: current?.tokens ?? null, error: current?.error ?? null };
}

function CsvRecords({ source, selection, provenance, activeProvenanceIds, onSourceSelect }: SourceViewerProps) {
  const csvSel = selection?.kind === "csv_records" ? selection : null;
  const { tokens, error } = useCsvTokens(api.sourceContentUrl(source.id), csvSel?.delimiter ?? null);
  const active = useActive(provenance, activeProvenanceIds);
  const skip = csvSel?.skipLeadingRecords ?? 0;
  const headerCount = csvSel?.headerRecordCount ?? 0;
  const header = tokens && headerCount === 1 ? tokens.records[skip]?.fields : null;
  const dataOffset = skip + headerCount;

  const groups = useMemo(() => {
    const m = new Map<number, { recordIndex: number; lineStart: number; lineEnd: number; fields: Set<number>; absent: boolean; ids: string[] }>();
    for (const p of active) {
      if (p.locator.type !== "csv_record") continue;
      const l = p.locator;
      const g = m.get(l.recordIndex) ?? { recordIndex: l.recordIndex, lineStart: l.lineStart, lineEnd: l.lineEnd, fields: new Set<number>(), absent: false, ids: [] };
      if (l.fieldIndex !== null) g.fields.add(l.fieldIndex);
      else g.absent = true;
      g.ids.push(p.id);
      m.set(l.recordIndex, g);
    }
    return [...m.values()].sort((a, b) => a.recordIndex - b.recordIndex);
  }, [active]);

  const selectRecord = (recordIndex: number) => {
    if (!onSourceSelect) return;
    onSourceSelect(provenance.filter((p) => p.locator.type === "csv_record" && p.locator.recordIndex === recordIndex).map((p) => p.id));
  };

  if (!csvSel) return <p className="text-[13px] text-ink-muted">No selection has been made for this file yet.</p>;

  const start = csvSel.recordInterval?.start ?? 0;
  const fallback = groups.length === 0 && tokens ? tokens.records.slice(dataOffset + start, dataOffset + start + 5).map((r, i) => ({ recordIndex: start + i, lineStart: r.lineStart, lineEnd: r.lineEnd, fields: new Set<number>(), absent: false, ids: [] })) : [];
  const shown = groups.length ? groups.slice(0, MAX_RECORDS_SHOWN) : fallback;

  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <p className="text-[12px] text-ink-muted">
        {source.filename} · {DELIMITER_NAMES[csvSel.delimiter].toLowerCase()}-delimited{skip ? ` · ${skip} leading records skipped` : ""} · {headerCount ? `record ${skip + 1} is the header` : "no header"}
        {csvSel.recordInterval ? ` · records ${csvSel.recordInterval.start + 1}–${csvSel.recordInterval.endExclusive}` : ""}
      </p>
      {error && <ErrorState title="Source records unavailable" message={error} />}
      {groups.length === 0 && <p className="text-ink-muted">Select a value in the data table to see the exact record and line it came from. The first selected records are shown below.</p>}
      {groups.length > MAX_RECORDS_SHOWN && <p className="text-[12px] text-ink-muted">Showing {MAX_RECORDS_SHOWN} of {groups.length} linked records.</p>}
      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {shown.map((g) => {
        const rec = tokens?.records[g.recordIndex + dataOffset];
        const lines = g.lineStart === g.lineEnd ? `line ${g.lineStart}` : `lines ${g.lineStart}–${g.lineEnd}`;
        return (
          <article key={g.recordIndex} className={`rounded-md border ${g.ids.length ? "border-accent" : "border-rule"} bg-surface`}>
            <header className="flex flex-wrap items-center gap-2 border-b border-rule px-3 py-1.5">
              <button type="button" className="text-left font-medium text-ink underline-offset-2 hover:underline disabled:no-underline" onClick={() => selectRecord(g.recordIndex)} disabled={!onSourceSelect}>
                Record {g.recordIndex + 1}
              </button>
              <span className="tabular text-[12px] text-ink-muted">{lines}</span>
              {g.ids.length > 0 && <Badge tone="accent">linked</Badge>}
              {g.absent && <Badge tone="estimate">a linked field is absent from this record</Badge>}
            </header>
            {rec ? (
              <dl className="grid grid-cols-[minmax(5rem,max-content)_minmax(0,1fr)] gap-x-3 gap-y-0.5 px-3 py-2 text-[13px]">
                {rec.fields.map((f, fi) => {
                  const hit = g.fields.has(fi);
                  return (
                    <div key={fi} className={`col-span-2 grid grid-cols-subgrid rounded-sm px-1 ${hit ? "bg-accent-soft font-semibold" : ""}`}>
                      <dt className="truncate text-ink-muted" title={header?.[fi] ?? `Field ${fi + 1}`}>
                        {hit && <span aria-hidden="true">▸ </span>}
                        {header?.[fi] || `Field ${fi + 1}`}
                      </dt>
                      <dd className="font-mono break-all whitespace-pre-wrap text-ink">{f === "" ? <span className="text-ink-faint italic">empty</span> : f}</dd>
                    </div>
                  );
                })}
              </dl>
            ) : (
              <p className="px-3 py-2 text-[12px] text-ink-muted">{tokens ? "This record is not in the current file." : "Loading…"}</p>
            )}
          </article>
        );
      })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

function XlsxCells({ source, selection, provenance, activeProvenanceIds, onSourceSelect }: SourceViewerProps) {
  const xSel = selection?.kind === "xlsx_range" ? selection : null;
  const active = useActive(provenance, activeProvenanceIds);
  const [state, setState] = useState<{ key: string; ins: Extract<StructuredInspection, { kind: "xlsx" }> | null; error: string | null } | null>(null);
  const key = `${source.id}|${xSel?.sheetName ?? ""}`;
  useEffect(() => {
    if (!xSel) return;
    let cancelled = false;
    api.inspectSource(source.id, { sheetName: xSel.sheetName }).then(
      (ins) => !cancelled && setState({ key, ins: ins.kind === "xlsx" ? ins : null, error: null }),
      (e: unknown) => !cancelled && setState({ key, ins: null, error: e instanceof Error ? e.message : "The sheet preview could not be loaded." }),
    );
    return () => {
      cancelled = true;
    };
  }, [source.id, xSel, key]);
  const current = state?.key === key ? state : null;

  const activeCells = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of active) if (p.locator.type === "xlsx_cell") m.set(p.locator.address, [...(m.get(p.locator.address) ?? []), p.id]);
    return m;
  }, [active]);

  if (!xSel) return <p className="text-[13px] text-ink-muted">No selection has been made for this workbook yet.</p>;
  const sheet = current?.ins?.sheets.find((s) => s.name === xSel.sheetName);
  const used = sheet?.usedRange ? parseRange(sheet.usedRange) : null;
  const range = xSel.range ? parseRange(xSel.range) : used;
  const rows = current?.ins?.previewRows ?? [];
  const lastPreviewRow = used ? used.top + rows.length - 1 : 0;
  const outside = [...activeCells.keys()].filter((a) => {
    const p = parseAddress(a);
    return !p || !used || p.row > lastPreviewRow || p.col < used.left || p.col >= used.left + (rows[0]?.length ?? 0);
  });

  const selectCell = (address: string) => {
    if (!onSourceSelect) return;
    onSourceSelect(provenance.filter((p) => p.locator.type === "xlsx_cell" && p.locator.address === address && p.locator.sheetName === xSel.sheetName).map((p) => p.id));
  };

  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <p className="text-[12px] text-ink-muted">
        {source.filename} · sheet “{xSel.sheetName}” · range {xSel.range ?? sheet?.usedRange ?? "used range"} · {xSel.headerRowCount ? "first row is the header" : "no header row"}
      </p>
      {activeCells.size > 0 && (
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="text-ink-muted">Linked cells:</span>
          {[...activeCells.keys()].slice(0, 24).map((a) => (
            <Badge key={a} tone="accent">
              {xSel.sheetName}!{a}
            </Badge>
          ))}
          {activeCells.size > 24 && <span className="text-[12px] text-ink-faint">…and {activeCells.size - 24} more</span>}
        </p>
      )}
      {activeCells.size === 0 && <p className="text-ink-muted">Select a value in the data table to see the exact cell it came from.</p>}
      {current?.error && <ErrorState title="Sheet preview unavailable" message={current.error} />}
      {outside.length > 0 && rows.length > 0 && <p className="text-[12px] text-ink-muted">{outside.length === 1 ? `${outside[0]} is` : `${outside.length} linked cells are`} below the first {rows.length} rows shown here.</p>}
      {used && rows.length > 0 && (
        <div className="overflow-auto rounded-md border border-rule" style={{ maxHeight: "28rem" }}>
          <table className="w-max min-w-full border-collapse text-[12px]">
            <caption className="sr-only">First rows of sheet {xSel.sheetName}, values as stored</caption>
            <thead className="sticky top-0 bg-sunken">
              <tr>
                <th scope="col" className="border-b border-rule px-2 py-1" />
                {rows[0].map((_, i) => (
                  <th key={i} scope="col" className="border-b border-l border-rule px-2 py-1 font-mono font-medium text-ink-muted">
                    {columnLetter(used.left + i)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => {
                const r = used.top + ri;
                return (
                  <tr key={ri}>
                    <th scope="row" className="tabular border-r border-rule bg-sunken px-2 py-1 text-right font-mono font-normal text-ink-muted">
                      {r}
                    </th>
                    {row.map((v, ci) => {
                      const c = used.left + ci;
                      const address = `${columnLetter(c)}${r}`;
                      const hit = activeCells.has(address);
                      const inRange = range && r >= range.top && r <= range.bottom && c >= range.left && c <= range.right;
                      return (
                        <td key={ci} className={`max-w-48 truncate border-l border-rule px-2 py-1 ${hit ? "bg-accent-soft font-semibold text-ink outline-2 -outline-offset-2 outline-accent" : inRange ? "text-ink" : "bg-canvas text-ink-faint"}`} title={`${address}${v ? `: ${v}` : ""}`}>
                          {inRange && onSourceSelect ? (
                            <button type="button" className="w-full text-left" onClick={() => selectCell(address)} aria-label={`Cell ${address}${hit ? " (linked)" : ""}`}>
                              {v ?? ""}
                            </button>
                          ) : (
                            (v ?? "")
                          )}
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
    </div>
  );
}
