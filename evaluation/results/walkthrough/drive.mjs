/**
 * Phase 2 merged-app walkthrough driver.
 * Uses system Google Chrome via playwright-core (not a repo dependency).
 * Writes screenshots and a JSON observation log. Does not invent outcomes.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("/tmp/unspin-pw/node_modules/playwright-core");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = join(ROOT, "evaluation/results/walkthrough");
const CSV = join(ROOT, "evaluation/inputs/noaa-gml-co2-mm-mlo-1974-05_2026-09.excerpt.csv");
const PNG = join(ROOT, "evaluation/inputs/noaa-gml-co2-trend-mlo-2026-10-09.png");
const BASE = "http://localhost:3106";

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

async function waitVisible(page, selector, timeout = 20000) {
  await page.locator(selector).first().waitFor({ state: "visible", timeout });
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
  // 1. Landing empty state
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const landing = await textOf(page);
  await shot(page, "01-landing-desktop.png");
  note("landing", landing.includes("Drop your data") ? "pass" : "fail", {
    url: page.url(),
    title: await page.title(),
    hasWordmark: landing.includes("UNSPIN"),
    hasUpload: landing.includes("Choose a file"),
    geminiNote: landing.includes("GEMINI_API_KEY") || landing.includes("not configured"),
    sessionNote: landing.includes("session only") || landing.includes("lost when the server restarts"),
    excerpt: landing.slice(0, 1200),
  });

  // 2. Upload NOAA CSV
  await page.locator('input[type="file"]').setInputFiles(CSV);
  await page.waitForTimeout(1500);
  const afterUpload = await textOf(page);
  await shot(page, "02-upload-csv.png");
  const uploadOk = afterUpload.includes("noaa-gml-co2-mm-mlo") || afterUpload.includes("Skip leading") || afterUpload.includes("record");
  note("upload", uploadOk ? "pass" : "fail", {
    url: page.url(),
    excerpt: afterUpload.slice(0, 1600),
  });

  // 3. Select: skip leading records (NOAA # comments) + header
  await page.getByText(/Suggested:/i).waitFor({ timeout: 15000 }).catch(() => {});
  const skipLabeled = page.getByLabel(/Skip leading records/i);
  let skipValue = null;
  if (await skipLabeled.count()) skipValue = await skipLabeled.inputValue();
  const afterPreview = await textOf(page);
  const suggested = afterPreview.match(/skip\s+(\d+)\s+leading/i);
  note("select-suggested-skip", suggested || skipValue ? "observed" : "fail", {
    skipInputValue: skipValue,
    suggestedSkip: suggested ? suggested[1] : null,
    hasHeaderControl: afterPreview.includes("Is a header"),
    hasPreview: afterPreview.includes("year") || afterPreview.includes("1974"),
    excerpt: afterPreview.slice(0, 800),
  });

  if (await skipLabeled.count()) {
    const current = await skipLabeled.inputValue();
    if (current !== "40") {
      await skipLabeled.fill("40");
      note("select-skip-set", "observed", { from: current, to: "40" });
      await page.waitForTimeout(400);
    }
  }

  const headerBtn = page.getByRole("radio", { name: /Is a header/i }).or(page.getByRole("button", { name: /Is a header/i }));
  if (await headerBtn.count()) {
    await headerBtn.first().click();
  }
  await shot(page, "03-csv-selection.png");
  const selectText = await textOf(page);
  note("select-csv", selectText.includes("Use this selection") ? "pass" : "fail", {
    excerpt: selectText.slice(0, 1800),
  });

  await page.getByRole("button", { name: /Use this selection/i }).click();
  await page.waitForTimeout(800);
  await shot(page, "04-extract-import.png");
  const extractText = await textOf(page);
  note("extract-screen", extractText.includes("Import data") || extractText.includes("Import") ? "pass" : "fail", {
    excerpt: extractText.slice(0, 1600),
    url: page.url(),
  });

  // 4. Import (deterministic parser, no Gemini)
  const importBtn = page.getByRole("button", { name: /Import data/i });
  if (await importBtn.count()) {
    await importBtn.click();
  } else {
    note("import-button", "fail", "Import data button not found");
  }
  await page.waitForURL(/dataset=/, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const workspace = await textOf(page);
  await shot(page, "05-workspace.png");
  const wsOk = workspace.includes("rows") && (workspace.includes("columns") || workspace.includes("Data"));
  note("import", wsOk ? "pass" : "fail", {
    url: page.url(),
    excerpt: workspace.slice(0, 2000),
  });

  // 5. Inspect a cell + source
  const grid = page.locator('[role="grid"]').first();
  await grid.waitFor({ timeout: 15000 });
  await grid.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  // If Enter opened editor, Escape back to inspector
  if ((await textOf(page)).includes("Unsaved edit") || (await textOf(page)).includes("Preview change")) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }
  const cell = page.locator('[role="gridcell"]').nth(3);
  if (await cell.count()) await cell.click();
  await page.waitForTimeout(400);
  await shot(page, "06-inspect-cell.png");
  const inspectText = await textOf(page);
  note("inspect", inspectText.includes("Original text") || inspectText.includes("Where this value comes from") ? "pass" : "fail", {
    excerpt: inspectText.slice(0, 2200),
  });

  // 6. Correct one value: preview then Save
  const editBtn = page.getByRole("button", { name: /Edit value/i });
  if (await editBtn.count()) {
    await editBtn.click();
  } else {
    await grid.focus();
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(300);
  const valueInput = page.locator('form[aria-label="Edit cell"] input').filter({ hasNot: page.locator('[type=checkbox]') }).last();
  // Prefer labeled Value field
  const labeledValue = page.getByLabel(/^Value$/i);
  let beforeVal = null;
  if (await labeledValue.count()) {
    beforeVal = await labeledValue.inputValue();
    // Nudge a decimal by +0.01 if it looks numeric, else append a mark
    if (/^\d+(\.\d+)?$/.test(beforeVal)) {
      const n = beforeVal.includes(".") ? `${beforeVal}1`.replace(/(\.\d+)1$/, (_, f) => {
        const next = (Number(`0${f}`) + 0.01).toFixed(f.length - 1);
        return `.${next.slice(2)}`;
      }) : `${beforeVal}`;
      // simpler: if 333.19 -> 333.20
      const num = Number(beforeVal);
      const next = (num + 0.01).toFixed(Math.max(2, (beforeVal.split(".")[1] || "").length));
      await labeledValue.fill(next);
      note("edit-value", "observed", { before: beforeVal, after: next });
    } else {
      await labeledValue.fill(beforeVal);
      note("edit-value", "observed", { before: beforeVal, unchanged: true });
    }
  }
  const noteInput = page.getByLabel(/Note/i);
  if (await noteInput.count()) {
    await noteInput.fill("Walkthrough check against NOAA source text.");
  }
  await page.getByRole("button", { name: /Preview change/i }).click();
  await page.getByRole("button", { name: /^Save$/i }).waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
  await shot(page, "07-preview-edit.png");
  const previewText = await textOf(page);
  note("correct-preview", previewText.includes("Before") || previewText.includes("Previewed") || previewText.includes("Save") ? "pass" : "fail", {
    excerpt: previewText.slice(0, 1800),
  });
  const saveBtn = page.getByRole("button", { name: /^Save$/i });
  if (await saveBtn.count() && !(await saveBtn.isDisabled())) {
    await saveBtn.click();
    await page.waitForTimeout(1000);
  } else {
    note("correct-save", "fail", "Save button missing or disabled after preview");
  }
  await shot(page, "08-after-save.png");
  const afterSave = await textOf(page);
  note("correct-save", afterSave.includes("version 2") || afterSave.includes("v2") || afterSave.includes("user") || afterSave.includes("edited") || afterSave.includes("Your edit") ? "pass" : "observed", {
    excerpt: afterSave.slice(0, 1800),
    url: page.url(),
  });

  // 7. Chart: select a point via keyboard navigator (same event as click)
  const nav = page.getByRole("group", { name: /Chart points/i });
  if (await nav.count()) {
    await nav.focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(200);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
  } else {
    // Fallback: click first plotly point
    const plot = page.locator(".js-plotly-plot, .plotly").first();
    if (await plot.count()) {
      const box = await plot.boundingBox();
      if (box) await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.5);
      await page.waitForTimeout(500);
    }
  }
  await shot(page, "09-chart-select.png");
  const chartText = await textOf(page);
  const selectedRow = await page.locator('[role="row"][aria-selected="true"]').count();
  note("chart", chartText.includes("Keyboard") || selectedRow > 0 ? "pass" : "observed", {
    selectedRows: selectedRow,
    excerpt: chartText.slice(0, 1800),
  });

  // 8. Undo via History
  await page.getByRole("button", { name: /^History$/i }).click();
  await page.getByRole("button", { name: /Undo last change/i }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(300);
  await shot(page, "10-history.png");
  const histText = await textOf(page);
  note("history-open", histText.includes("Undo last change") || histText.includes("Current version") ? "pass" : "fail", {
    excerpt: histText.slice(0, 1600),
  });
  await page.getByRole("button", { name: /Undo last change/i }).click();
  await page.waitForTimeout(300);
  const confirmUndo = page.getByRole("button", { name: /^Undo$/i });
  if (await confirmUndo.count()) await confirmUndo.click();
  await page.waitForTimeout(800);
  await shot(page, "11-after-undo.png");
  const afterUndo = await textOf(page);
  note("undo", afterUndo.includes("Done") || afterUndo.includes("restore") || afterUndo.includes("version") ? "pass" : "observed", {
    excerpt: afterUndo.slice(0, 1600),
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  await page.locator("dialog[open]").waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  const remainingDialog = page.locator("dialog[open]");
  if (await remainingDialog.count()) {
    await remainingDialog.locator("button", { hasText: /^Close$/ }).click({ force: true }).catch(async () => {
      await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close?.() || d.removeAttribute("open")));
    });
  }

  // 9. Export CSV + JSON + manifest
  await page.getByRole("button", { name: /^Export$/i }).click({ force: true });
  await page.waitForTimeout(400);
  await shot(page, "12-export-dialog.png");
  const exportText = await textOf(page);
  // Enable JSON if unchecked
  const jsonBox = page.getByRole("checkbox", { name: /Exact data/i }).or(page.locator("label:has-text('Exact data') input"));
  if (await jsonBox.count()) {
    const checked = await jsonBox.first().isChecked().catch(() => false);
    if (!checked) await jsonBox.first().check({ force: true }).catch(async () => {
      await page.locator("label:has-text('Exact data')").click();
    });
  }
  const csvBox = page.getByRole("checkbox", { name: /CSV data/i }).or(page.locator("label:has-text('CSV data') input"));
  const manBox = page.getByRole("checkbox", { name: /Provenance manifest/i }).or(page.locator("label:has-text('Provenance manifest') input"));
  for (const box of [csvBox, manBox]) {
    if (await box.count()) {
      const checked = await box.first().isChecked().catch(() => false);
      if (!checked) await page.locator(`label:has-text("${(await box.first().textContent().catch(() => "")) || "CSV"}")`).click().catch(() => {});
    }
  }
  // Click labels to ensure all three
  for (const label of ["CSV data", "Provenance manifest", "Exact data"]) {
    const lab = page.locator(`label:has-text("${label}")`);
    if (await lab.count()) {
      const input = lab.locator("input[type=checkbox]");
      if (await input.count() && !(await input.isChecked())) await lab.click();
    }
  }
  await shot(page, "13-export-formats.png");
  await page.getByRole("button", { name: /^Download$/i }).click();
  await page.waitForTimeout(1500);
  await shot(page, "14-export-done.png");
  note("export", downloads.length >= 1 ? "pass" : "fail", {
    downloads: downloads.map((d) => d.filename),
    dialog: (await textOf(page)).slice(0, 1200),
  });
  const closeExport = page.getByRole("button", { name: /^Close$/i });
  if (await closeExport.count()) await closeExport.first().click().catch(() => {});

  // 10. Refresh restore
  const urlBefore = page.url();
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const urlAfter = page.url();
  await shot(page, "15-after-refresh.png");
  const refreshText = await textOf(page);
  const restored = /[?&]source=/.test(urlAfter) && /[?&]dataset=/.test(urlAfter) && (refreshText.includes("rows") || refreshText.includes("Data"));
  const lost = refreshText.includes("could not be reopened") || refreshText.includes("Drop your data");
  note("refresh", restored ? "pass" : lost ? "fail" : "observed", {
    urlBefore,
    urlAfter,
    restored,
    lost,
    excerpt: refreshText.slice(0, 1600),
  });

  // 11. Failed extraction: title-only crop of NOAA PNG
  // Start over
  await page.getByRole("button", { name: /UNSPIN/i }).click().catch(async () => {
    await page.goto(BASE, { waitUntil: "networkidle" });
  });
  await page.waitForTimeout(600);
  // If still on dataset, click wordmark again
  if (!(await page.getByRole("heading", { name: /Drop your data/i }).count())) {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
  }
  await page.locator('input[type="file"]').setInputFiles(PNG);
  await page.waitForTimeout(1500);
  await shot(page, "16-png-uploaded.png");
  const pngText = await textOf(page);
  note("fail-upload-png", pngText.includes("noaa-gml-co2-trend") || pngText.includes("Whole image") || pngText.includes("Region") ? "pass" : "fail", {
    excerpt: pngText.slice(0, 1600),
    url: page.url(),
  });

  // Title-only crop via percent fields: top ~2–14% of the figure (title band)
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
  } else {
    // Drag a thin band near the top
    const surface = page.getByRole("application").first();
    const box = await surface.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.02);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.14);
      await page.mouse.up();
    }
  }
  await shot(page, "17-title-crop.png");
  const cropText = await textOf(page);
  note("fail-title-crop", cropText.includes("Selected") || cropText.includes("region") ? "pass" : "observed", {
    excerpt: cropText.slice(0, 1400),
  });

  const useSel = page.getByRole("button", { name: /Use this selection/i });
  if (await useSel.count() && !(await useSel.isDisabled())) {
    await useSel.click();
    await page.waitForTimeout(800);
  }
  await shot(page, "18-failed-extraction.png");
  const failText = await textOf(page);
  const sourceStill = failText.includes("noaa-gml-co2-trend") || failText.includes("Extract data") || failText.includes("selected region");
  const invented = /[?&]dataset=/.test(page.url()) && failText.includes("rows ×");
  const stageReal = failText.includes("not configured") || failText.includes("Unavailable") || failText.includes("Cancel") || failText.includes("Start extraction");
  const startBtn = page.getByRole("button", { name: /Start extraction/i });
  const startDisabled = (await startBtn.count()) ? await startBtn.isDisabled() : null;
  note("failed-extraction", sourceStill && !invented ? "pass" : "fail", {
    sourceStill,
    inventedDataset: invented,
    stageReal,
    startDisabled,
    url: page.url(),
    excerpt: failText.slice(0, 2000),
  });

  // 12. Mobile landing + workspace-ish
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await shot(page, "19-landing-mobile.png");
  note("mobile-landing", "observed", { excerpt: (await textOf(page)).slice(0, 800) });

  writeFileSync(join(OUT, "notes.json"), JSON.stringify({ notes, downloads, finishedAt: new Date().toISOString() }, null, 2));
  console.log("DONE", notes.length, "notes;", downloads.length, "downloads");
} catch (err) {
  note("driver-error", "fail", { message: String(err), stack: err?.stack });
  await shot(page, "99-error.png").catch(() => {});
  writeFileSync(join(OUT, "notes.json"), JSON.stringify({ notes, downloads, error: String(err) }, null, 2));
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
