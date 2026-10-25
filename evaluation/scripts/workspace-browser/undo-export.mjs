import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { connect } from "./cdp.mjs";

const R = "/Users/islomshamsiev/Desktop/unspin/evaluation/results/workspace-redesign";
const DL = "/tmp/unspin-files/dl";
rmSync(DL, { recursive: true, force: true });
mkdirSync(DL, { recursive: true });
const c = await connect();
await c.send("Page.bringToFront");
await c.viewport(1440, 900);
const versions = () => c.evaluate(`[...document.querySelectorAll('select option')].filter(o => o.textContent.startsWith('Version')).map(o => o.textContent + (o.selected ? '*' : '')).join(', ')`);
const row2 = () => c.evaluate(`[...document.querySelectorAll('[role=row]')].find(r => /Open\\s*•?\\s*2$/.test(r.querySelector('[role=rowheader], [role=gridcell]')?.textContent.trim() ?? '') || r.textContent.includes('Open • 2') || r.textContent.includes('Open 2'))?.querySelector('[role=gridcell]:nth-child(2)')?.textContent.trim() ?? null`);

if (!(await c.evaluate(`!!document.querySelector('dialog[open]')`))) {
  await c.evaluate(`[...document.querySelectorAll('header button')].find(b => b.textContent.trim().startsWith('More')).click()`);
  await c.wait(200);
  await c.evaluate(`[...document.querySelectorAll('[role=menuitem]')].find(m => m.textContent.startsWith('Version history')).click()`);
  await c.until(`[...document.querySelectorAll('dialog[open] button')].some(b => b.textContent.includes('Undo last change') && !b.disabled)`, 15000);
  await c.evaluate(`[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.includes('Undo last change')).click()`);
  await c.wait(300);
}
console.log("dialog open:", await c.evaluate(`[...document.querySelectorAll('dialog[open]')].map(d => d.querySelector('h2')?.textContent).join(',')`));
console.log("confirm buttons:", await c.evaluate(`[...document.querySelectorAll('dialog[open] button')].map(b => b.textContent.trim()).filter(Boolean).join(' | ')`));
const beforeUndo = await versions();
await c.evaluate(`[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.trim() === 'Undo')?.click()`);
await c.until(`[...document.querySelectorAll('select option')].filter(o => o.selected).map(o => o.textContent).join() !== ${JSON.stringify('PLACEHOLDER')}`.replace('"PLACEHOLDER"', JSON.stringify(beforeUndo.split(', ').find((v) => v.endsWith('*')).slice(0, -1))), 20000);
console.log('before undo:', beforeUndo);
await c.wait(800);
await c.shot(`${R}/after-history-undo-1440.png`);
await c.key("Escape");
await c.wait(400);
console.log("undone; versions:", await versions(), "| cell:", await c.evaluate(`[...document.querySelectorAll('[role=gridcell]')].some(c => c.textContent.trim() === '14.23')`) ? "14.23 present" : "14.23 missing");

// Older version read-only
await c.evaluate(`(() => { const s = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent.startsWith('Version 2'))); s.value = [...s.options].find(o => !o.textContent.includes('(current)')).value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await c.until(`document.body.innerText.includes('read-only')`, 15000);
await c.wait(500);
console.log("older version:", await c.evaluate(`document.body.innerText.match(/Viewing version[^\\n]*/)?.[0]`), "| back button:", await c.evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Back to current')`));
await c.shot(`${R}/after-older-version-1440.png`);
await c.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Back to current').click()`);
await c.until(`!document.body.innerText.includes('read-only')`, 15000);
console.log("back to current:", await versions());

// Export
await c.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DL });
await c.evaluate(`[...document.querySelectorAll('header button')].find(b => b.textContent.trim() === 'Export').click()`);
await c.wait(600);
console.log("export dialog:", JSON.stringify(await c.evaluate(`document.querySelector('dialog[open]')?.innerText.slice(0, 500)`)));
await c.shot(`${R}/after-export-1440.png`);
await c.evaluate(`[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.trim() === 'Download').click()`);
await c.until(`document.querySelector('dialog[open]')?.innerText.includes('Downloaded')`, 20000);
console.log("export result:", await c.evaluate(`document.querySelector('dialog[open]')?.innerText.match(/Downloaded[^\\n]*/)?.[0]`));
await c.wait(2000);
const files = readdirSync(DL);
console.log("downloaded files:", files);
for (const f of files.filter((f) => f.endsWith(".csv"))) console.log(f, "first lines:", readFileSync(`${DL}/${f}`, "utf8").split("\n").slice(0, 3));
await c.key("Escape");
c.close();
