import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Committed, permitted inputs from evaluation/sources.json. */
export const COMMITTED = {
  noaaCo2Excerpt: {
    manifestId: "noaa-co2-mm-mlo-csv-2026-10",
    path: "evaluation/inputs/noaa-gml-co2-mm-mlo-1974-05_2026-09.excerpt.csv",
    sha256: "a653f1af074f08f25f7b51e97d4b93b2e5485269a10a11df167e73e5cd7e6fad",
    mimeType: "text/csv",
  },
  noaaCo2TrendPng: {
    manifestId: "noaa-co2-trend-mlo-2026-10",
    path: "evaluation/inputs/noaa-gml-co2-trend-mlo-2026-10-09.png",
    sha256: "1f3bf74036f52d1b77068eb1a8fb143410297fb3a5848e3961a3b0247212d5af",
    mimeType: "image/png",
  },
  eiaSteoXlsx: {
    manifestId: "eia-steo-2026-10-xlsx",
    path: "evaluation/inputs/eia-steo-2026-10-base.xlsx",
    sha256: "54989362410da4aff5673580396380c3a8f4f111fa6d01c6d4fab05ef90efbf4",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  eiaLegacyXls: {
    manifestId: "eia-pet-weekly-gasoline-xls",
    path: "evaluation/inputs/eia-pet-weekly-retail-gasoline-EMM_EPMR_PTE_NUS_DPGw.xls",
    sha256: "28e286b42e8ac505a904906fea66660601e3626208b34eb16715abe44c6c5bf2",
    mimeType: "application/vnd.ms-excel",
  },
} as const;

/** Fetched by evaluation/fetch-inputs.sh into .data/qa; absent in a fresh checkout. */
export const LOCAL_ONLY = {
  steoPdf: {
    manifestId: "eia-steo-2026-10-pdf-p15-wti",
    path: ".data/qa/oct26.pdf",
    sha256: "741d247cffcae488208ad0c5e03966405283eec3ff6b830d02285cbe25b44fe6",
    mimeType: "application/pdf",
  },
} as const;

export type InputRef = { manifestId: string; path: string; sha256: string; mimeType: string };

export function readInput(ref: InputRef): Uint8Array {
  return new Uint8Array(readFileSync(join(REPO_ROOT, ref.path)));
}

export function inputPresent(ref: InputRef): boolean {
  const p = join(REPO_ROOT, ref.path);
  return existsSync(p) && sha256(readFileSync(p)) === ref.sha256;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function basename(path: string): string {
  return path.split("/").pop()!;
}

/** NOAA excerpt data rows (after '#' comments and header), split into raw field strings. */
export function noaaDataRows(): string[][] {
  const text = new TextDecoder().decode(readInput(COMMITTED.noaaCo2Excerpt));
  const lines = text.split("\n").filter((l) => l && !l.startsWith("#"));
  return lines.slice(1).map((l) => l.split(","));
}
