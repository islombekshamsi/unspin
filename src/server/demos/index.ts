import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError, DecimalStringSchema, PdfBoxSchema, PreparedDemoReportSchema, isAppError, newId, type Column, type DemoMode, type Owner, type ParsedDatasetDraft, type PreparedDemoReport, type Source, type SourceSelection } from "@/contracts";
import finance from "./data/finance.json";
import academic from "./data/academic.json";
import research from "./data/research.json";
import { buildDraft } from "@/server/ingestion/draft";
import { resolveSelection } from "@/server/ingestion";
import { buildInitialDataset, validateDraft } from "@/server/orchestration/extraction";
import { getSourceBytes } from "@/server/orchestration/sources";
import { getRepositories } from "@/server/storage";
const Cell = z.object({ raw: z.string(), value: z.string().nullable(), page: z.number().int().positive().optional(), box: PdfBoxSchema.optional(), line: z.number().int().positive().optional(), field: z.number().int().nonnegative().optional() });
const FileSchema = z.object({
  mode: z.enum(["finance", "academic", "research"]), filename: z.string(), sha256: z.string().length(64), title: z.string(), scope: z.string(), limitations: z.array(z.string()), preparation: z.string(),
  tables: z.array(z.object({ key: z.string(), title: z.string(), page: z.number().int().positive(), note: z.string(), columns: z.array(z.object({ key: z.string(), label: z.string(), type: z.enum(["text", "decimal"]), unit: z.string().nullable(), currency: z.string().nullable(), role: z.enum(["category", "x", "y", "other"]), percent: z.boolean() })), rows: z.array(z.object({ cells: z.record(z.string(), Cell) })) })),
  insights: z.array(z.object({ title: z.string(), text: z.string(), datasetKey: z.string(), rows: z.array(z.number().int().nonnegative()), columns: z.array(z.string()) })),
});
export const DEMOS = { finance: FileSchema.parse(finance), academic: FileSchema.parse(academic), research: FileSchema.parse(research) };
type DemoFile = z.infer<typeof FileSchema>;
type DemoTable = DemoFile["tables"][number];
const marker = (mode: DemoMode, key: string) => `Prepared demo v3 [${mode}:${key}]`;
function selectionId(sourceId: string, mode: DemoMode, key: string) { return `sel_${createHash("sha256").update(`${sourceId}:${marker(mode,key)}`).digest("hex").slice(0,32)}`; }

function chartFor(table: DemoTable, columns: Column[]): PreparedDemoReport["datasets"][number]["chart"] {
  const recommended = table.key === 'penguins' ? ['flipper_length_mm','body_mass_g'] : table.key === 'tuition' ? ['program','annual25','annual26'] : table.key.startsWith('housing-') ? ['room','rate25','rate26'] : table.key === 'fees' ? ['campus','full','part','low'] : table.key === 'room-food-history' ? ['period','rate'] : table.key === 'auto-finance' ? ['period','v0'] : ['period',...table.columns.filter((c)=>c.type==='decimal').slice(0,3).map((c)=>c.key)];
    const columnIds=recommended.map((key)=>columns[table.columns.findIndex((c)=>c.key===key)].id);

  return {xColumnId:columnIds[0],yColumnIds:columnIds.slice(1),kind:table.key==='penguins'?'scatter':'bar'};
}

export function buildDemoDraft(source: Source, selection: SourceSelection, file: DemoFile, table: DemoTable): ParsedDatasetDraft {
  const built = buildDraft({ sourceId: source.id, selectionId: selection.id, labels: table.columns.map((c) => c.label), rows: table.rows.map((row, ri) => ({ sourceOrder: ri, cells: table.columns.map((column) => {
    const c = row.cells[column.key];
    if (!c) throw new AppError("internal", "Prepared table has a missing cell.");
    if (column.type === "decimal" && c.value !== null) DecimalStringSchema.parse(c.value);
    return { rawText: c.raw, text: c.value, missingReason: c.value === null ? "not_reported" as const : null,
      notes: ["Prepared offline from the supplied source; not a live AI extraction.", ...(c.value === null ? [`Source marker ${JSON.stringify(c.raw)} is treated as missing; no value is imputed.`] : c.raw !== c.value ? ["Display notation/context was normalized; the original source string is retained."] : [])],
      locator: c.box && c.page ? { type: "pdf_box" as const, pageNumber: c.page, coordinateSystem: "pdf_user_space_points" as const, box: c.box } : { type: "csv_record" as const, recordIndex: ri, lineStart: c.line ?? ri + 2, lineEnd: c.line ?? ri + 2, fieldIndex: c.field ?? null },
      availability: "precise" as const, provenanceLabel: c.page ? `Prepared table ${table.title}, PDF page ${c.page}` : `CSV record ${ri + 1}, line ${c.line ?? ri + 2}` };
  }) })) });
  const pdf = source.kind === "pdf";
  built.columns.forEach((column, i) => {
    const spec = table.columns[i]; column.dataType = spec.type; column.semanticRole = spec.role; column.unit = spec.currency === 'USD' ? (spec.unit?.replace(/^USD\s*/, '') || null) : spec.unit; column.currency = spec.currency; column.percentRepresentation = spec.percent ? "percent_number" : null;
    column.sourceScale = spec.type === "decimal" ? "linear" : "categorical";
    for (const row of built.rows) row.cells[column.id].valueType = spec.type;
  });
  if (pdf) built.provenance.forEach((p) => { p.extractionMethod = "pdf_text"; });
  return { ...built, title: table.title, description: `${marker(file.mode,table.key)}. ${table.note}`.slice(0,2000), extractionMethod: pdf ? "pdf_text" : "deterministic_parser", coverage: pdf ? "partial_selection" : "complete_selection", coverageNote: pdf ? `Prepared table subset: ${table.note}` : null, extraction: null, issues: [{ kind: "extraction_issue", severity: "info", message: `Prepared demo from the exact supplied file. ${table.note}`.slice(0,1000), rowIds: [], cellIds: [], columnIds: [], evidence: [] }] };
}

export async function prepareDemo(owner: Owner, sourceId: string, mode: DemoMode): Promise<PreparedDemoReport> {
  const { source, bytes } = await getSourceBytes(owner, sourceId);
  const file = DEMOS[mode];
  if (source.sha256 !== file.sha256 || createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new AppError("bad_request", `This prepared ${mode} demo requires the exact ${file.filename} supplied for preparation. Choose Live import for another file.`);
  const repos = getRepositories();
  for (const table of file.tables) {
    const id = selectionId(sourceId,mode,table.key);
    if (await repos.datasets.findBySelection(owner,id)) continue;
    let selection = await repos.selections.get(owner,id);
    if (!selection) {
      const resolved = await resolveSelection(source,bytes,source.kind === "csv" ? { kind: "csv_records", delimiter: ",", headerRecordCount: 1, selectedColumnIndexes: null, recordInterval: null } : { kind: "pdf_region", pageNumber: table.page, region: null, userHint: null });
      selection = { ...resolved, id, createdAt: new Date().toISOString() };
      await repos.selections.create(owner,selection);
    }
    const draft = buildDemoDraft(source,selection,file,table);
    validateDraft(draft,true);
    const initial = buildInitialDataset(owner,newId("ds"),source.id,selection.id,draft);
    initial.dataset.defaultChart = chartFor(table,initial.snapshot.version.columns);
    try { await repos.datasets.create(owner,{ dataset: initial.dataset, initialSnapshot: initial.snapshot, provenance: draft.provenance, historyEntry: initial.history }); }
    catch (error) { if (isAppError(error) && error.code === 'idempotency_conflict') continue; throw error; }
    // Helpful source-preserving starting views. No summary observations are invented.
    const numeric = initial.snapshot.version.columns.filter((c) => c.dataType === "decimal");
    const category = initial.snapshot.version.columns.find((c) => c.semanticRole === "category") ?? initial.snapshot.version.columns[0];
    const suggestions = mode === "research" ? ['Adelie','Chinstrap','Gentoo'].map((name) => ({ name, filterColumnId: initial.snapshot.version.columns.find((c) => c.label === 'species')!.id, filterText: name, columnIds: initial.snapshot.version.columns.map((c) => c.id) })) : [{ name: mode === "finance" ? '2026 observations · quarterly and monthly' : 'Main comparison', filterColumnId: mode === "finance" ? category.id : null, filterText: mode === "finance" ? '2026 ' : null, columnIds: [category.id,...numeric.filter((c) => mode !== "academic" || c.unit?.includes('academic year') || c.label.includes('rate') || c.label.includes('credits')).slice(0,3).map((c) => c.id)] }];
    for (const spec of suggestions) await repos.views.create(owner,{ id: newId('view'), datasetId: initial.dataset.id, name: spec.name, spec: { preset:'all', search: null, filterColumnId: spec.filterColumnId, filterText: spec.filterText, sort: { columnId: null, direction: 'asc' }, columnIds: spec.columnIds }, createdAt: new Date().toISOString(),updatedAt: new Date().toISOString() });
  }
  const report = await getPreparedDemo(owner,sourceId);
  if (!report) throw new AppError('internal','Prepared demo could not be reopened.');
  return report;
}

export async function getPreparedDemo(owner: Owner, sourceId: string): Promise<PreparedDemoReport | null> {
  const { source } = await getSourceBytes(owner,sourceId);
  const file = Object.values(DEMOS).find((d) => d.sha256 === source.sha256);
  if (!file) return null;
  const repos=getRepositories();
  const datasets: PreparedDemoReport['datasets']=[];
  const snapshots = new Map<string,Awaited<ReturnType<typeof repos.datasets.getVersion>>>();
  for (const table of file.tables) {
    const dataset=await repos.datasets.findBySelection(owner,selectionId(sourceId,file.mode,table.key));
    if (!dataset) continue;
    const snapshot = await repos.datasets.getVersion(owner,dataset.id,dataset.initialVersionId);
    if (!snapshot) continue;
    datasets.push({ id: dataset.id, title: dataset.title,key:table.key,versionId:dataset.initialVersionId,chart:chartFor(table,snapshot.version.columns) });
    snapshots.set(table.key,snapshot);
  }
  if (!datasets.length) return null;
  const insights: PreparedDemoReport['insights']=[];
  for (const insight of file.insights) {
    const table=file.tables.find((t)=>t.key===insight.datasetKey)!; const snapshot=snapshots.get(table.key);const dataset=datasets.find((d)=>d.key===table.key);
    if (!snapshot || !dataset) continue;
    const rows=insight.rows.map((i)=>snapshot.rows[i]).filter(Boolean);
    const ids=insight.columns.map((key)=>snapshot.version.columns[table.columns.findIndex((c)=>c.key===key)]?.id).filter(Boolean);
    const cells=rows.flatMap((row)=>ids.map((id)=>row.cells[id]).filter(Boolean));
    insights.push({title:insight.title,text:insight.text,datasetId:dataset.id,evidence:{origin:'quality',datasetVersionId:dataset.versionId,rowIds:rows.map((r)=>r.id),cellIds:cells.map((c)=>c.id),provenanceIds:[...new Set(cells.flatMap((c)=>c.provenanceIds))]}});
  }
  return PreparedDemoReportSchema.parse({ mode:file.mode,title:file.title,scope:file.scope,limitations:file.limitations,datasets,insights });
}
