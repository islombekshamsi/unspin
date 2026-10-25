import { connect } from "./cdp.mjs";

const R = "/Users/islomshamsiev/Desktop/unspin/evaluation/results/workspace-redesign";
const [w = "1440", h = "900", tag = "1440"] = process.argv.slice(2);
const c = await connect();
await c.viewport(Number(w), Number(h), Number(w) < 700);
await c.send("Page.reload");
await c.until(`!!document.querySelector('[role=tablist][aria-label=Workspace]')`, 30000);
await c.until(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Show in data' && b.offsetParent)`, 20000);
const state = () =>
  c.evaluate(`({
    tab: document.querySelector('[role=tab][aria-selected=true]')?.textContent,
    back: [...document.querySelectorAll('button')].find(b => b.textContent.includes('Back to'))?.textContent ?? null,
    note: [...document.querySelectorAll('main [role=status]')].map(e => e.textContent).filter(Boolean).slice(0,3),
    selectedCells: document.querySelectorAll('[role=gridcell][aria-selected=true]').length,
    activeRecords: [...document.querySelectorAll('[data-active=true], [aria-current=true]')].length,
    scrollY: Math.round(scrollY), sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, iw: innerWidth,
  })`);

console.log("start", JSON.stringify(await state()));
await c.evaluate(`[...document.querySelectorAll('main section li, main section article, main section div')].find(e => e.textContent.startsWith('Stored as text'))?.querySelector('button:not([aria-expanded])') ? 1 : 0`);
// "Show in data" on the first visible fact card
await c.evaluate(`[...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Show in data' && b.offsetParent)[0].click()`);
await c.wait(1200);
console.log("after show in data", JSON.stringify(await state()));
await c.shot(`${R}/after-data-${tag}.png`);
await c.clickText("← Back to overview");
await c.wait(600);
console.log("after back", JSON.stringify(await state()));
await c.evaluate(`[...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Show source' && b.offsetParent)[0].click()`);
await c.wait(1500);
console.log("after show source", JSON.stringify(await state()));
await c.shot(`${R}/after-source-${tag}.png`);
console.log(
  "source view text:",
  JSON.stringify(await c.evaluate(`document.querySelector('[role=tabpanel]:not([hidden])')?.innerText.slice(0, 500)`)),
);
c.close();
