"use client";

import { useState } from "react";
import type { Column, DateFormat, MissingReason, NumericLocale, SelectionEvent, TransformOperation } from "@/contracts";
import { Button, Field, Select, TextInput, UnavailableNote } from "@/components/ui";
import { MISSING_LABELS } from "@/features/grid/lib/format";
import { conversionsFrom } from "@/server/transforms/unit-registry";

type OpKind =
  | "trim_text"
  | "parse_numeric"
  | "parse_date"
  | "mark_missing"
  | "rename_column"
  | "set_column_unit"
  | "convert_unit"
  | "remove_selected_rows"
  | "remove_exact_duplicates"
  | "set_review_status";

const OP_LABELS: Record<OpKind, string> = {
  trim_text: "Trim whitespace",
  parse_numeric: "Read as numbers",
  parse_date: "Read as dates",
  mark_missing: "Mark tokens as missing",
  rename_column: "Rename column",
  set_column_unit: "Set unit or currency",
  convert_unit: "Convert unit",
  remove_selected_rows: "Remove selected rows",
  remove_exact_duplicates: "Remove exact repeats",
  set_review_status: "Set review status of selected cells",
};

const DATE_FORMATS: DateFormat[] = ["ISO_8601", "YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY", "DD.MM.YYYY", "YYYY-MM", "YYYY"];
const GROUPING: Array<{ value: string; label: string; sep: NumericLocale["groupingSeparator"] }> = [
  { value: "comma", label: "“,” (1,234)", sep: "," },
  { value: "point", label: "“.” (1.234)", sep: "." },
  { value: "space", label: "space (1 234)", sep: " " },
  { value: "nbsp", label: "non-breaking space", sep: "\u00a0" },
  { value: "apos", label: "“'” (1'234)", sep: "'" },
  { value: "none", label: "none", sep: null },
];

/** Build one allowlisted operation with explicit parameters; it always goes to a preview first. */
export function OperationBuilder({
  columns,
  linked,
  versionId,
  busy,
  onPreview,
}: {
  columns: Column[];
  linked: SelectionEvent | null;
  versionId: string;
  busy: boolean;
  onPreview: (op: TransformOperation) => void;
}) {
  const [kind, setKind] = useState<OpKind>("parse_numeric");
  const [columnId, setColumnId] = useState(columns[0]?.id ?? "");
  const [multi, setMulti] = useState<ReadonlySet<string>>(new Set(columns.map((c) => c.id)));
  const [scopeLinked, setScopeLinked] = useState(false);
  // parse_numeric
  const [decimal, setDecimal] = useState<"." | ",">(".");
  const [grouping, setGrouping] = useState("comma");
  const [groupingPolicy, setGroupingPolicy] = useState<"allow" | "forbid">("allow");
  const [percentPolicy, setPercentPolicy] = useState<"reject" | "keep_percent_number" | "to_fraction">("reject");
  const [currencyMode, setCurrencyMode] = useState<"reject" | "strip_symbol">("reject");
  const [currency, setCurrency] = useState("");
  const [parens, setParens] = useState(false);
  // parse_date
  const [format, setFormat] = useState<DateFormat>("YYYY-MM-DD");
  const [timezone, setTimezone] = useState<"date_only" | "utc">("date_only");
  // mark_missing
  const [tokens, setTokens] = useState("");
  const [reason, setReason] = useState<MissingReason>("not_reported");
  // rename / unit
  const [label, setLabel] = useState("");
  const [unit, setUnit] = useState("");
  const [unitCurrency, setUnitCurrency] = useState("");
  const [conversionId, setConversionId] = useState("");
  const [reviewStatus, setReviewStatus] = useState<"accepted" | "unreviewed" | "unavailable">("accepted");

  const column = columns.find((c) => c.id === columnId) ?? columns[0];
  const linkedHere = linked && linked.datasetVersionId === versionId ? linked : null;
  const linkedRows = linkedHere?.rowIds ?? [];
  const linkedCells = linkedHere?.cellIds ?? [];
  const tokenList = tokens.split("\n").filter((t) => t.length > 0);
  const conversions = conversionsFrom(column?.unit ?? null);

  const build = (): TransformOperation | string => {
    if (!column && kind !== "remove_selected_rows" && kind !== "set_review_status") return "Choose a column.";
    const rowScope = scopeLinked && linkedRows.length ? linkedRows : null;
    switch (kind) {
      case "trim_text":
        return multi.size ? { type: "trim_text", columnIds: columns.filter((c) => multi.has(c.id)).map((c) => c.id), rowIds: rowScope } : "Choose at least one column.";
      case "parse_numeric": {
        if (currencyMode === "strip_symbol" && !/^[A-Z]{3}$/.test(currency)) return "Enter the ISO currency code, e.g. USD.";
        const sep = GROUPING.find((g) => g.value === grouping)!.sep;
        if (sep === decimal) return "The grouping and decimal separators must differ.";
        return {
          type: "parse_numeric",
          columnId: column.id,
          locale: { decimalSeparator: decimal, groupingSeparator: sep },
          groupingPolicy: sep === null ? "forbid" : groupingPolicy,
          percentPolicy,
          currencyPolicy: currencyMode === "strip_symbol" ? { mode: "strip_symbol", currency } : { mode: "reject" },
          parenthesesNegative: parens,
          onFailure: "keep_and_flag",
        };
      }
      case "parse_date":
        return { type: "parse_date", columnId: column.id, format, timezonePolicy: timezone, onFailure: "keep_and_flag" };
      case "mark_missing":
        if (tokenList.length === 0) return "Enter at least one exact token.";
        if (tokenList.length > 32 || tokenList.some((t) => t.length > 64)) return "Use at most 32 tokens of up to 64 characters.";
        return { type: "mark_missing", columnId: column.id, explicitTokens: tokenList, rowIds: rowScope, missingReason: reason };
      case "rename_column":
        return label.trim() ? { type: "rename_column", columnId: column.id, newLabel: label.trim() } : "Enter the new name.";
      case "set_column_unit":
        if (unitCurrency && !/^[A-Z]{3}$/.test(unitCurrency)) return "Currency must be an ISO code such as EUR, or empty.";
        return { type: "set_column_unit", columnId: column.id, unit: unit.trim() || null, currency: unitCurrency || null };
      case "convert_unit":
        return conversionId ? { type: "convert_unit", columnId: column.id, registeredConversionId: conversionId } : "Choose a conversion.";
      case "remove_selected_rows":
        return linkedRows.length ? { type: "remove_selected_rows", rowIds: linkedRows } : "Select rows in the table first.";
      case "remove_exact_duplicates":
        return multi.size ? { type: "remove_exact_duplicates", columnIds: columns.filter((c) => multi.has(c.id)).map((c) => c.id), retainPolicy: "first_in_source_order" } : "Choose at least one column.";
      case "set_review_status":
        return linkedCells.length ? { type: "set_review_status", cellIds: linkedCells, reviewStatus } : "Select cells in the table first.";
    }
  };
  const built = build();
  const problem = typeof built === "string" ? built : null;

  const columnSelect = (
    <Field label="Column">
      {(id) => (
        <Select id={id} value={column?.id ?? ""} onChange={(e) => setColumnId(e.target.value)}>
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
  const multiSelect = (legend: string) => (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-[12px] font-medium text-ink-muted">{legend}</legend>
      <div className="max-h-36 overflow-auto rounded-md border border-rule p-2">
        {columns.map((c) => (
          <label key={c.id} className="flex items-center gap-2 py-0.5 text-[13px]">
            <input
              type="checkbox"
              checked={multi.has(c.id)}
              onChange={(e) => {
                const next = new Set(multi);
                if (e.target.checked) next.add(c.id);
                else next.delete(c.id);
                setMulti(next);
              }}
            />
            <span className="truncate">{c.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
  const rowScopeToggle = (
    <label className="flex items-center gap-2 text-[13px]">
      <input type="checkbox" checked={scopeLinked && linkedRows.length > 0} disabled={linkedRows.length === 0} onChange={(e) => setScopeLinked(e.target.checked)} />
      Only the {linkedRows.length || ""} selected row{linkedRows.length === 1 ? "" : "s"}
      {linkedRows.length === 0 && <span className="text-ink-faint">(none selected)</span>}
    </label>
  );

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (typeof built !== "string") onPreview(built);
      }}
    >
      <Field label="Operation">
        {(id) => (
          <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as OpKind)}>
            {(Object.keys(OP_LABELS) as OpKind[]).map((k) => (
              <option key={k} value={k}>
                {OP_LABELS[k]}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {kind === "trim_text" && (
        <>
          {multiSelect("Columns to trim")}
          {rowScopeToggle}
        </>
      )}

      {kind === "parse_numeric" && (
        <>
          {columnSelect}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Decimal separator">
              {(id) => (
                <Select id={id} value={decimal} onChange={(e) => setDecimal(e.target.value as "." | ",")}>
                  <option value=".">“.” point (1.5)</option>
                  <option value=",">“,” comma (1,5)</option>
                </Select>
              )}
            </Field>
            <Field label="Thousands separator">
              {(id) => (
                <Select id={id} value={grouping} onChange={(e) => setGrouping(e.target.value)}>
                  {GROUPING.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Thousands separators in values">
            {(id) => (
              <Select id={id} value={groupingPolicy} onChange={(e) => setGroupingPolicy(e.target.value as "allow" | "forbid")}>
                <option value="allow">Allow (groups of three only)</option>
                <option value="forbid">Refuse values that contain them</option>
              </Select>
            )}
          </Field>
          <Field label="Percent signs">
            {(id) => (
              <Select id={id} value={percentPolicy} onChange={(e) => setPercentPolicy(e.target.value as typeof percentPolicy)}>
                <option value="reject">Refuse values with %</option>
                <option value="keep_percent_number">Keep as percent number (12.5% → 12.5)</option>
                <option value="to_fraction">Convert to fraction (12.5% → 0.125, exact)</option>
              </Select>
            )}
          </Field>
          <Field label="Currency symbols">
            {(id) => (
              <Select id={id} value={currencyMode} onChange={(e) => setCurrencyMode(e.target.value as "reject" | "strip_symbol")}>
                <option value="reject">Refuse values with a currency symbol</option>
                <option value="strip_symbol">Remove the symbol and record the currency</option>
              </Select>
            )}
          </Field>
          {currencyMode === "strip_symbol" && (
            <Field label="Currency (ISO code)" hint="Symbols that do not match it (e.g. € for USD) are refused.">
              {(id) => <TextInput id={id} value={currency} maxLength={3} placeholder="USD" onChange={(e) => setCurrency(e.target.value.toUpperCase())} />}
            </Field>
          )}
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={parens} onChange={(e) => setParens(e.target.checked)} />
            Read “(123)” as −123
          </label>
          <p className="text-[12px] text-ink-faint">Digits are kept exactly as written. Values that do not fit these settings stay unchanged and get a note.</p>
        </>
      )}

      {kind === "parse_date" && (
        <>
          {columnSelect}
          <Field label="Format in the source">
            {(id) => (
              <Select id={id} value={format} onChange={(e) => setFormat(e.target.value as DateFormat)}>
                {DATE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f === "ISO_8601" ? "ISO 8601 (2020-03-04 or 2020-03-04T10:00Z)" : f}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Time zone policy" hint={timezone === "utc" ? "Only ISO 8601 text with Z or an offset is accepted; times without a zone are not guessed." : "Calendar dates without a time zone. Text with a time is refused."}>
            {(id) => (
              <Select id={id} value={timezone} onChange={(e) => setTimezone(e.target.value as "date_only" | "utc")}>
                <option value="date_only">Calendar dates (no time zone)</option>
                <option value="utc">Instants, stored in UTC</option>
              </Select>
            )}
          </Field>
        </>
      )}

      {kind === "mark_missing" && (
        <>
          {columnSelect}
          <Field label="Exact tokens, one per line" hint="Case and spaces count: “NA” does not match “na” or “ NA”.">
            {(id) => (
              <textarea
                id={id}
                rows={3}
                value={tokens}
                onChange={(e) => setTokens(e.target.value)}
                className="w-full rounded-md border border-rule-strong bg-surface px-2.5 py-1.5 font-mono text-[13px]"
                placeholder={"NA\n—"}
              />
            )}
          </Field>
          <Field label="Reason">
            {(id) => (
              <Select id={id} value={reason} onChange={(e) => setReason(e.target.value as MissingReason)}>
                {(Object.keys(MISSING_LABELS) as MissingReason[]).map((r) => (
                  <option key={r} value={r}>
                    {MISSING_LABELS[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {rowScopeToggle}
        </>
      )}

      {kind === "rename_column" && (
        <>
          {columnSelect}
          <Field label="New name">{(id) => <TextInput id={id} value={label} maxLength={300} placeholder={column?.label} onChange={(e) => setLabel(e.target.value)} />}</Field>
        </>
      )}

      {kind === "set_column_unit" && (
        <>
          {columnSelect}
          <Field label="Unit" hint="Labels the values only; nothing is converted.">
            {(id) => <TextInput id={id} value={unit} maxLength={64} placeholder={column?.unit ?? "e.g. kg"} onChange={(e) => setUnit(e.target.value)} />}
          </Field>
          <Field label="Currency (ISO code, optional)">
            {(id) => <TextInput id={id} value={unitCurrency} maxLength={3} placeholder={column?.currency ?? "e.g. EUR"} onChange={(e) => setUnitCurrency(e.target.value.toUpperCase())} />}
          </Field>
        </>
      )}

      {kind === "convert_unit" && (
        <>
          {columnSelect}
          {conversions.length === 0 ? (
            <UnavailableNote>
              {column?.unit
                ? `No reviewed exact conversion starts from “${column.unit}”.`
                : "This column has no unit. Set its unit first."}{" "}
              Supported: mass (mg, g, kg), length (mm, cm, m, km), time (ms, s, min, h) where the factor is exact. Currency and temperature are not converted.
            </UnavailableNote>
          ) : (
            <Field label="Conversion">
              {(id) => (
                <Select id={id} value={conversionId} onChange={(e) => setConversionId(e.target.value)}>
                  <option value="">Choose…</option>
                  {conversions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} (× {c.factor})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </>
      )}

      {kind === "remove_selected_rows" && (
        <p className="text-[13px] text-ink-muted">
          {linkedRows.length
            ? `${linkedRows.length} row${linkedRows.length === 1 ? " is" : "s are"} selected. The preview lists each one before anything is removed.`
            : "Select rows in the table first: click a row number, Control/Command-click to add rows, Shift-click for a range."}
        </p>
      )}

      {kind === "remove_exact_duplicates" && (
        <>
          {multiSelect("Compare these columns")}
          <p className="text-[12px] text-ink-faint">A repeat may be a real repeated measurement. The first row in source order is kept; the preview lists every row that would be removed.</p>
        </>
      )}

      {kind === "set_review_status" && (
        <>
          <p className="text-[13px] text-ink-muted">{linkedCells.length ? `${linkedCells.length} selected cell${linkedCells.length === 1 ? "" : "s"}.` : "Select cells in the table first."}</p>
          <Field label="Status">
            {(id) => (
              <Select id={id} value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value as typeof reviewStatus)}>
                <option value="accepted">Reviewed (checked against the source)</option>
                <option value="unreviewed">Not reviewed</option>
                <option value="unavailable">Review unavailable</option>
              </Select>
            )}
          </Field>
          <p className="text-[12px] text-ink-faint">This records your review. It does not make an estimate exact.</p>
        </>
      )}

      {problem && <p className="text-[12px] text-ink-muted">{problem}</p>}
      <div>
        <Button type="submit" variant="primary" size="sm" disabled={!!problem || busy}>
          Preview
        </Button>
      </div>
    </form>
  );
}
