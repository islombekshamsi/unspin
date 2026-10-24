import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, noaaDataRows, sha256 } from "../helpers/real-inputs";

interface ManifestFile { path: string; committed: boolean; sha256: string; byteSize: number | null }
interface ManifestRecord {
  id: string;
  kind: string;
  license: { redistributionPermitted: string; automatedOrModelProcessingPermitted: string };
  files: ManifestFile[];
  reference?: { origin: string; file?: string };
}

const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "evaluation/sources.json"), "utf8")) as { records: ManifestRecord[] };

describe("evaluation/sources.json", () => {
  it("has unique ids and both scientific and financial records with an easy and a difficult case", () => {
    const ids = manifest.records.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const roles = (manifest.records as unknown as { role: string; domain: string }[]).map((r) => `${r.domain}:${r.role}`);
    expect(roles).toContain("scientific:easy_case");
    expect(roles.some((r) => r === "financial:difficult_case")).toBe(true);
  });

  it.each(manifest.records.flatMap((r) => r.files.filter((f) => f.committed).map((f) => [r.id, f] as const)))(
    "%s: committed file exists, matches its sha256, and is permitted for redistribution",
    (id, f) => {
      const rec = manifest.records.find((r) => r.id === id)!;
      expect(rec.license.redistributionPermitted.startsWith("yes")).toBe(true);
      const bytes = readFileSync(join(REPO_ROOT, f.path));
      expect(sha256(bytes)).toBe(f.sha256);
      if (f.byteSize !== null) expect(bytes.byteLength).toBe(f.byteSize);
    },
  );

  it("records with unknown permission are never committed", () => {
    for (const r of manifest.records) {
      if (r.license.redistributionPermitted === "unknown") expect(r.files.every((f) => !f.committed)).toBe(true);
    }
  });

  it("reference files exist and are author-provided", () => {
    for (const r of manifest.records) {
      if (!r.reference?.file) continue;
      expect(existsSync(join(REPO_ROOT, r.reference.file))).toBe(true);
      expect(r.reference.origin).toBe("author_provided");
    }
  });
});

describe("reference values are verbatim copies of the inputs", () => {
  it("NOAA trend reference = excerpt rows 2021-01..2026-09 (69 months, two series)", () => {
    const ref = readFileSync(join(REPO_ROOT, "evaluation/reference/noaa-co2-trend-mlo-2021-01_2026-09.reference.csv"), "utf8").trim().split("\n");
    expect(ref[0]).toBe("year,month,average_ppm,deseasonalized_ppm,ndays,sdev_ppm,unc_ppm");
    const expected = noaaDataRows()
      .filter((f) => Number(f[0]) >= 2021)
      .map(([y, m, , a, d, n, s, u]) => [y, m, a, d, n, s, u].join(","));
    expect(ref.slice(1)).toEqual(expected);
    expect(expected).toHaveLength(69);
  });

  it("EIA WTI reference: 72 months 2022-01..2027-12, 57 historical through 2026-09, cells C6..BV6", () => {
    const rows = readFileSync(join(REPO_ROOT, "evaluation/reference/eia-steo-2026-10-wtipuus-monthly.reference.csv"), "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
    expect(rows).toHaveLength(72);
    expect(rows[0]).toEqual(["2022-01", "83.22", "historical", "C6"]);
    expect(rows.at(-1)).toEqual(["2027-12", "68", "forecast", "BV6"]);
    expect(rows.filter((r) => r[2] === "historical")).toHaveLength(57);
    expect(rows.find((r) => r[0] === "2026-09")![2]).toBe("historical");
    expect(rows.find((r) => r[0] === "2026-10")![2]).toBe("forecast");
    for (const r of rows) expect(r[1]).toMatch(/^\d+(\.\d+)?$/);
  });
});
