import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { ExportManifestSchema, type ExportResult, type Owner } from "@/contracts";
import { createExport } from "@/server/orchestration/datasets";
import { buildCsv, type ExportContext } from "@/server/exports";
import { getRepositories } from "@/server/storage";
import { commitManualEdit, seedDataset, utf8, type SeededDataset } from "../helpers/fixtures";
import { NOAA_SAMPLE, noaaTable } from "../helpers/noaa";
import { makeOwner } from "../helpers/owners";
import { COMMITTED } from "../helpers/real-inputs";
import { PLACEHOLDER_REASON, isPlaceholder } from "../helpers/stubs";

const probeOwner = makeOwner("probe");
const probe = await seedDataset(probeOwner, noaaTable(NOAA_SAMPLE));
const exportsPlaceholder = await isPlaceholder(() =>
  buildCsv({
    source: probe.source,
    selection: probe.selection,
    dataset: probe.dataset,
    snapshot: probe.snapshot,
    history: [],
    provenance: probe.provenance,
    scope: { kind: "full" },
    exportedAt: new Date().toISOString(),
  } satisfies ExportContext),
);

const file = (r: ExportResult, suffix: string) => r.files.find((f) => f.filename.endsWith(suffix))!;
const parseCsv = (text: string) => Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), { skipEmptyLines: true }).data;

/** Protocol strings (not real data): spreadsheet formula triggers mixed with a legitimate negative decimal. */
const INJECTION_ROWS: (string | null)[][] = [
  ['=HYPERLINK("http://example.invalid","x")', "-12.5"],
  ["+SUM(1,2)", "3"],
  ["@cmd", "0"],
  ["-2+3", "-0.001"],
  ["\t=1", null],
  ["plain text", "4"],
];

async function injectionDataset(owner: Owner): Promise<SeededDataset> {
  return seedDataset(owner, {
    title: "Formula injection protocol fixture",
    sourceBytes: utf8("label,value\n"),
    columns: [{ label: "label", dataType: "text" }, { label: "value", dataType: "decimal" }],
    rows: INJECTION_ROWS,
  });
}

describe.skipIf(exportsPlaceholder)(`exports [skips while ${PLACEHOLDER_REASON("exports.buildCsv/buildJsonData/buildManifest")}]`, () => {
  it("CSV neutralizes formula triggers in text but leaves legitimate negative decimals unchanged", async () => {
    const owner = makeOwner();
    const s = await injectionDataset(owner);
    const r = await createExport(owner, s.dataset.id, { versionId: s.snapshot.version.id, formats: ["csv"], scope: { kind: "full" }, acknowledgePartial: false });
    const rows = parseCsv(file(r, ".csv").content);
    const body = rows.slice(rows.length - INJECTION_ROWS.length);
    for (const [label] of body) expect(label).not.toMatch(/^[=+@\t\r-]/);
    expect(body.map((r) => r[1])).toEqual(["-12.5", "3", "0", "-0.001", expect.any(String), "4"]);
    expect(body[4][1]).not.toBe("0");
  });

  it("JSON export keeps exact original strings (no spreadsheet escaping) and null for missing", async () => {
    const owner = makeOwner();
    const s = await injectionDataset(owner);
    const r = await createExport(owner, s.dataset.id, { versionId: s.snapshot.version.id, formats: ["json"], scope: { kind: "full" }, acknowledgePartial: false });
    const text = file(r, ".json").content;
    for (const [label] of INJECTION_ROWS) expect(text).toContain(JSON.stringify(label).slice(1, -1));
    expect(text).toContain("-12.5");
  });

  it("CSV of real NOAA rows keeps exact decimal text and all rows of the version", async () => {
    const owner = makeOwner();
    const s = await seedDataset(owner, noaaTable(NOAA_SAMPLE));
    const r = await createExport(owner, s.dataset.id, { versionId: s.snapshot.version.id, formats: ["csv", "manifest"], scope: { kind: "full" }, acknowledgePartial: false });
    const csv = file(r, ".csv").content;
    for (const raw of ["1975.9583", "330.77", "-9.99", "0.00", "-1"]) expect(csv).toContain(raw);
    const manifest = ExportManifestSchema.parse(JSON.parse(file(r, ".manifest.json").content));
    expect(manifest.rowCount).toBe(6);
    const dataRows = parseCsv(csv).filter((row) => /^19\d\d$/.test(row[0]));
    expect(dataRows).toHaveLength(6);
  });

  it("manifest has complete lineage and no private identifiers or storage keys", async () => {
    const owner = makeOwner();
    const s = await seedDataset(owner, noaaTable(NOAA_SAMPLE));
    const v2 = await commitManualEdit(owner, s, s.snapshot, 3, s.columns[3].id, "330.80");
    const r = await createExport(owner, s.dataset.id, { versionId: v2.version.id, formats: ["manifest"], scope: { kind: "full" }, acknowledgePartial: false });
    const text = file(r, ".manifest.json").content;
    const m = ExportManifestSchema.parse(JSON.parse(text));
    expect(m.source).toMatchObject({ sourceId: s.source.id, sha256: COMMITTED.noaaCo2Excerpt.sha256, kind: "csv", processingDisclosure: "local_parser" });
    expect(m.dataset).toMatchObject({ initialVersionId: s.snapshot.version.id, exportedVersionId: v2.version.id, currentVersionId: v2.version.id });
    expect(m.history.map((h) => h.kind)).toEqual(["initial", "transform"]);
    expect(m.selection.id).toBe(s.selection.id);
    expect(m.reviewSummary.corrected).toBe(1);
    expect(m.reviewStatement).not.toMatch(/\bverified\b/i);
    const rec = await getRepositories().sources.get(owner, s.source.id);
    expect(text).not.toContain(owner.ownerId);
    expect(text).not.toContain(rec!.blobKey);
  });

  it("view scope exports only the chosen rows (in the given order) and columns", async () => {
    const owner = makeOwner();
    const s = await seedDataset(owner, noaaTable(NOAA_SAMPLE));
    const rowIds = [s.snapshot.rows[4].id, s.snapshot.rows[1].id];
    const columnIds = [s.columns[2].id, s.columns[3].id];
    const r = await createExport(owner, s.dataset.id, {
      versionId: s.snapshot.version.id,
      formats: ["csv", "manifest"],
      scope: { kind: "view", rowIds, columnIds, description: "two months" },
      acknowledgePartial: false,
    });
    const rows = parseCsv(file(r, ".csv").content);
    const data = rows.filter((row) => /^19\d\d\.\d+$/.test(row[0]));
    expect(data).toEqual([
      ["1976.0417", "331.56"],
      ["1975.7917", "328.36"],
    ]);
    expect(rows.every((row) => row.length === 2)).toBe(true);
    expect(ExportManifestSchema.parse(JSON.parse(file(r, ".manifest.json").content)).scope).toMatchObject({ kind: "view", rowIds });
  });

  it("acknowledged partial exports carry the coverage status and note in the manifest", async () => {
    const owner = makeOwner();
    const s = await seedDataset(owner, { ...noaaTable(NOAA_SAMPLE), coverage: "partial_selection", coverageNote: "Only six months selected" });
    const r = await createExport(owner, s.dataset.id, { versionId: s.snapshot.version.id, formats: ["manifest"], scope: { kind: "full" }, acknowledgePartial: true });
    const m = ExportManifestSchema.parse(JSON.parse(file(r, ".manifest.json").content));
    expect(m.dataset).toMatchObject({ coverage: "partial_selection", coverageNote: "Only six months selected" });
  });
});
