import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { connect } from "./cdp.mjs";

const R = "/Users/islomshamsiev/Desktop/unspin/evaluation/results/workspace-redesign";
const DL = "/tmp/unspin-files/dl";
mkdirSync(DL, { recursive: true });
const c = await connect();
await c.send("Page.bringToFront");
await c.viewport(1440, 900);
await c.send("Page.reload");
await c.until(`!!document.querySelector('[role=tablist][aria-label=Workspace]')`, 30000);
await c.wait(800);
const active = () => c.evaluate(`(() => { const a = document.activeElement; const l = a?.id ? document.querySelector('label[for="' + a.id + '"]')?.textContent : ''; return (a.getAttribute('role') ?? a.tagName) + ':' + (l || a.textContent.trim().slice(0, 30)); })()`);
const versions = () => c.evaluate(`[...document.querySelectorAll('select option')].filter(o => o.textContent.startsWith('Version')).map(o => o.textContent + (o.selected ? '*' : '')).join(', ')`);
const cellText = (row) => c.evaluate(`(() => { const rows = [...document.querySelectorAll('[role=row]')]; const r = rows.find(r => r.querySelector('[role=rowheader]')?.textContent.includes('${row}') || r.textContent.includes('Open • ${row}') || r.textContent.includes('Open ${row}')); return r ? [...r.querySelectorAll('[role=gridcell]')].slice(0, 2).map(c => c.textContent.trim()).join(' | ') : null; })()`);
const clickEl = async (expr) => {
  const box = await c.evaluate(`(() => { const e = ${expr}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!box) throw new Error("no element for " + expr);
  for (const type of ["mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
};

await c.evaluate(`[...document.querySelectorAll('[role=tab]')].find(t => t.textContent === 'Data').click()`);
await c.wait(500);
console.log("versions:", await versions());
const target = `[...document.querySelectorAll('[role=gridcell]')].find(c => c.textContent.trim() === '14.23')`;
await clickEl(target);
await c.wait(200);
console.log("clicked cell; focus", await active());
await c.key("Enter");
await c.wait(600);
console.log("after Enter: inspector visible", await c.evaluate(`[...document.querySelectorAll('aside')].some(a => a.offsetParent && a.textContent.includes('Cell inspector'))`), "| focus", await active());
await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 4, commands: ["selectAll"] });
await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 4 });
await c.type("14.24");
await c.key("Enter");
await c.until(`document.body.innerText.includes('Before → after')`, 15000);
console.log("preview:", await c.evaluate(`[...document.querySelectorAll('[role=status]')].map(s => s.textContent).find(t => t.includes('Before'))`));
await c.shot(`${R}/after-edit-preview-1440.png`);
await c.key("Enter");
await c.until(`[...document.querySelectorAll('select option')].some(o => o.textContent.startsWith('Version 2'))`, 20000);
await c.wait(800);
console.log("applied; versions:", await versions(), "| row 2:", await cellText(2));

c.close();
