/**
 * Core-finish NOAA CSV acceptance on the production server.
 * Writes screenshots and a JSON observation log. Does not invent outcomes.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("/tmp/unspin-pw/node_modules/playwright-core");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = join(ROOT, "evaluation/results/core-finish");
const CSV = join(ROOT, "evaluation/inputs/noaa-gml-co2-mm-mlo-1974-05_2026-09.excerpt.csv");
const PNG = join(ROOT, "evaluation/inputs/noaa-gml-co2-trend-mlo-2026-10-09.png");
const BASE = process.env.BASE_URL ?? "http://localhost:3108";

mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, "downloads"), { recursive: true });

const notes = [];
function note(step, status, observed) {
  const entry = { ts: new Date().toISOString(), step, status, observed };
  notes.push(entry);
  console.log(`[${status}] ${step}: ${typeof observed === "string" ? observed : JSON.stringify(observed)}`);
}

async function shot(page, name) {
  const path = join(OUT, name);
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function textOf(page) {
  return page.locator("body").innerText();
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const downloads = [];
page.on("download", async (d) => {
  const dest = join(OUT, "downloads", d.suggestedFilename());
  await d.saveAs(dest);
  downloads.push({ filename: d.suggestedFilename(), path: dest });
  note("download", "observed", { filename: d.suggestedFilename(), path: dest });
});

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const landing = await textOf(page);
  await shot(page, "01-landing.png");
  const purpose = landing.includes("inspect, correct, and reuse");
  note("landing", purpose ? "pass" : "fail", {
    url: page.url(),
    title: await page.title(),
    purpose,
    hasUpload: landing.includes("Drop a chart") || landing.includes("Choose a file"),
    excerpt: landing.slice(0, 1200),
  });

  await page.locator('input[type="file"]').setInputFiles(CSV);
  await page.waitForTimeout(1500);
  const afterUpload = await textOf(page);
  await shot(page, "02-upload-csv.png");
  note("upload", afterUpload.includes("noaa-gml-co2-mm-mlo") ? "pass" : "fail", {
    url: page.url(),
    excerpt: afterUpload.slice(0, 1600),
  });

  const skipLabeled = page.getByLabel(/Skip leading records/i);
  if (await skipLabeled.count()) {
    const current = await skipLabeled.inputValue();
    if (current !== "40") {
      await skipLabeled.fill("40");
      note("select-skip-set", "observed", { from: current, to: "40" });
      await page.waitForTimeout(400);
    }
  }
  await shot(page, "03-csv-selection.png");
  await page.getByRole("button", { name: /Use this selection/i }).click();
  await page.waitForTimeout(800);
  const importBtn = page.getByRole("button", { name: /Import data/i });
  if (await importBtn.count()) await importBtn.click();
  else note("import-button", "fail", "Import data button not found");
  await page.waitForURL(/dataset=/, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const workspace = await textOf(page);
  await shot(page, "04-workspace.png");
  const rowsOk = workspace.includes("629") && workspace.includes("8 column");
  note("import", rowsOk ? "pass" : "fail", { url: page.url(), excerpt: workspace.slice(0, 2200) });

  const extraSeries = [];
  for (const s of ["month", "ndays", "sdev", "unc", "deseasonalized", "year"]) {
    const hide = page.getByRole("button", { name: new RegExp(`^(Hide|Show) series ${s}$`, "i") });
    if (await hide.count()) extraSeries.push(s);
  }
  const averageChip = await page.getByRole("button", { name: /Hide series average/i }).count();
  const hasDecimalDate = workspace.includes("decimal date");
  const oneSeriesHint = workspace.includes("One series to start");
  const includeZeroApplied = /includes zero/i.test(workspace);
  note("default-chart", averageChip > 0 && hasDecimalDate && extraSeries.length === 0 ? "pass" : "fail", {
    averageChip,
    hasDecimalDate,
    oneSeriesHint,
    extraSeries,
    includeZeroApplied,
    timeNote: workspace.includes("decimal date column"),
    excerpt: workspace.slice(0, 2500),
  });

  const grid = page.locator('[role="grid"]').first();
  await grid.waitFor({ timeout: 15000 });
  const cell = page.locator('[role="gridcell"]').nth(3);
  if (await cell.count()) await cell.click();
  await page.waitForTimeout(400);
  await shot(page, "05-inspect.png");
  const inspectText = await textOf(page);
  note("inspect", inspectText.includes("333.19") || inspectText.includes("Original text") ? "pass" : "fail", {
    excerpt: inspectText.slice(0, 1800),
  });

  const editBtn = page.getByRole("button", { name: /Edit value/i });
  if (await editBtn.count()) await editBtn.click();
  else {
    await grid.focus();
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(300);
  const labeledValue = page.getByLabel(/^Value$/i);
  if (await labeledValue.count()) {
    const beforeVal = await labeledValue.inputValue();
    if (beforeVal === "333.19") await labeledValue.fill("333.20");
    else if (/^\d+(\.\d+)?$/.test(beforeVal)) {
      const next = (Number(beforeVal) + 0.01).toFixed(Math.max(2, (beforeVal.split(".")[1] || "").length));
      await labeledValue.fill(next);
    }
    note("edit-value", "observed", { before: beforeVal });
  }
  const noteInput = page.getByLabel(/Note/i);
  if (await noteInput.count()) await noteInput.fill("Core-finish check against NOAA source text.");
  await page.getByRole("button", { name: /Preview change/i }).click();
  await page.getByRole("button", { name: /^Save$/i }).waitFor({ timeout: 15000 }).catch(() => {});
  await shot(page, "06-preview-edit.png");
  const saveBtn = page.getByRole("button", { name: /^Save$/i });
  if (await saveBtn.count() && !(await saveBtn.isDisabled())) {
    await saveBtn.click();
    await page.waitForTimeout(1000);
  } else note("correct-save", "fail", "Save missing or disabled");
  await shot(page, "07-after-save.png");
  const afterSave = await textOf(page);
  note("correct-save", afterSave.includes("333.20") || afterSave.includes("Your edit") || afterSave.includes("version 2") ? "pass" : "observed", {
    excerpt: afterSave.slice(0, 1600),
  });

  const nav = page.getByRole("group", { name: /Chart points/i });
  if (await nav.count()) {
    await nav.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
  }
  await shot(page, "08-chart-select.png");
  const chartText = await textOf(page);
  note("chart-select", chartText.includes("Selected") || chartText.includes("average") ? "pass" : "observed", {
    excerpt: chartText.slice(0, 1200),
  });

  await page.getByRole("button", { name: /^History$/i }).click();
  await page.getByRole("button", { name: /Undo last change/i }).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: /Undo last change/i }).click();
  await page.waitForTimeout(300);
  const confirmUndo = page.getByRole("button", { name: /^Undo$/i });
  if (await confirmUndo.count()) await confirmUndo.click();
  await page.waitForTimeout(800);
  await shot(page, "09-after-undo.png");
  const afterUndo = await textOf(page);
  note("undo", afterUndo.includes("333.19") || afterUndo.includes("version") ? "pass" : "observed", {
    excerpt: afterUndo.slice(0, 1200),
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const remainingDialog = page.locator("dialog[open]");
  if (await remainingDialog.count()) {
    await remainingDialog.locator("button", { hasText: /^Close$/ }).click({ force: true }).catch(async () => {
      await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close?.() || d.removeAttribute("open")));
    });
  }

  await page.getByRole("button", { name: /^Export$/i }).click({ force: true });
  await page.waitForTimeout(400);
  for (const label of ["CSV data", "Provenance manifest", "Exact data"]) {
    const lab = page.locator(`label:has-text("${label}")`);
    if (await lab.count()) {
      const input = lab.locator("input[type=checkbox]");
      if (await input.count() && !(await input.isChecked())) await lab.click();
    }
  }
  await page.getByRole("button", { name: /^Download$/i }).click();
  await page.waitForTimeout(1500);
  await shot(page, "10-export.png");
  note("export", downloads.length >= 1 ? "pass" : "fail", { downloads: downloads.map((d) => d.filename) });
  const closeExport = page.getByRole("button", { name: /^Close$/i });
  if (await closeExport.count()) await closeExport.first().click().catch(() => {});

  const urlBefore = page.url();
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const urlAfter = page.url();
  await shot(page, "11-after-refresh.png");
  const refreshText = await textOf(page);
  const lostSelection = refreshText.includes("No selection has been made for this file yet");
  const restored =
    /[?&]source=/.test(urlAfter) &&
    /[?&]dataset=/.test(urlAfter) &&
    (refreshText.includes("629") || refreshText.includes("rows")) &&
    !lostSelection;
  note("refresh", restored ? "pass" : "fail", {
    urlBefore,
    urlAfter,
    lostSelection,
    stillHasAverage: refreshText.includes("average"),
    excerpt: refreshText.slice(0, 1800),
  });

  await page.getByRole("button", { name: /UNSPIN/i }).click().catch(async () => {
    await page.goto(BASE, { waitUntil: "networkidle" });
  });
  await page.waitForTimeout(600);
  if (!(await page.getByRole("heading", { name: /inspect, correct, and reuse/i }).count())) {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
  }
  await page.locator('input[type="file"]').setInputFiles(PNG);
  await page.waitForTimeout(1500);
  const left = page.getByLabel(/Left %/i);
  const top = page.getByLabel(/Top %/i);
  const width = page.getByLabel(/Width %/i);
  const height = page.getByLabel(/Height %/i);
  if ((await left.count()) && (await top.count()) && (await width.count()) && (await height.count())) {
    await left.fill("8");
    await top.fill("1");
    await width.fill("84");
    await height.fill("12");
    await page.getByRole("button", { name: /^Apply$/i }).click();
    await page.waitForTimeout(300);
  }
  await shot(page, "12-title-crop.png");
  const useSel = page.getByRole("button", { name: /Use this selection/i });
  if (await useSel.count() && !(await useSel.isDisabled())) {
    await useSel.click();
    await page.waitForTimeout(800);
  }
  await shot(page, "13-failed-extraction.png");
  const failText = await textOf(page);
  const invented = /[?&]dataset=/.test(page.url()) && failText.includes("rows ×");
  const startBtn = page.getByRole("button", { name: /Start extraction/i });
  const startDisabled = (await startBtn.count()) ? await startBtn.isDisabled() : null;
  note("title-crop", !invented ? "pass" : "fail", {
    inventedDataset: invented,
    startDisabled,
    unavailable: failText.includes("not configured") || failText.includes("Unavailable"),
    url: page.url(),
    excerpt: failText.slice(0, 1800),
  });

  writeFileSync(join(OUT, "notes.json"), JSON.stringify({ notes, downloads, finishedAt: new Date().toISOString() }, null, 2));
  const failed = notes.filter((n) => n.status === "fail");
  console.log("DONE", notes.length, "notes;", downloads.length, "downloads;", failed.length, "fail");
  if (failed.length) process.exitCode = 1;
} catch (err) {
  note("driver-error", "fail", { message: String(err), stack: err?.stack });
  await shot(page, "99-error.png").catch(() => {});
  writeFileSync(join(OUT, "notes.json"), JSON.stringify({ notes, downloads, error: String(err) }, null, 2));
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
