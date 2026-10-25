import { connect } from "./cdp.mjs";

const R = "/Users/islomshamsiev/Desktop/unspin/evaluation/results/workspace-redesign";
const c = await connect();
await c.viewport(1440, 900);
const tab = () => c.evaluate(`document.querySelector('[role=tab][aria-selected=true]')?.textContent`);
const active = () => c.evaluate(`(() => { const a = document.activeElement; return a ? (a.getAttribute('role') ?? a.tagName) + ':' + (a.textContent ?? '').trim().slice(0, 40) : null; })()`);
const ready = () => c.until(`!!document.querySelector('[role=tablist][aria-label=Workspace]')`, 30000);
const dsId = await c.evaluate(`new URL(location.href).searchParams.get('dataset')`);

// Keyboard tabs
await c.evaluate(`document.querySelector('[role=tab][aria-selected=true]').focus()`);
await c.key("ArrowRight");
await c.wait(300);
console.log("ArrowRight ->", await tab(), "| focus", await active());
await c.key("End");
await c.wait(300);
console.log("End ->", await tab());

// Refresh persistence
await c.send("Page.reload");
await ready();
await c.wait(500);
console.log("after reload tab:", await tab(), "| stored:", await c.evaluate(`sessionStorage.getItem('unspin.workspace.${dsId}')`));

// Obsolete layout state
await c.evaluate(`sessionStorage.setItem('unspin.workspace.${dsId}', JSON.stringify({ overviewOpen: false, focus: 'chart', tab: 'chart' }))`);
await c.send("Page.reload");
await ready();
await c.wait(500);
console.log("obsolete state ->", await tab(), "| rewritten:", await c.evaluate(`sessionStorage.getItem('unspin.workspace.${dsId}')`));
console.log("focus/expand buttons left:", await c.evaluate(`[...document.querySelectorAll('button')].filter(b => /^(Focus|Expand|Collapse)/.test(b.textContent.trim())).length`));

// More menu by keyboard
await c.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'More').focus()`);
await c.key("Enter");
await c.wait(300);
console.log("menu items:", await c.evaluate(`[...document.querySelectorAll('[role=menuitem]')].map(m => m.textContent.trim()).join(' | ')`), "| focus", await active());
await c.key("ArrowDown");
await c.key("Enter");
await c.wait(600);
console.log("opened drawer:", await c.evaluate(`[...document.querySelectorAll('dialog[open]')].map(d => d.querySelector('h2')?.textContent).join(',')`), "| focus", await active());
await c.shot(`${R}/after-history-drawer-1440.png`);
await c.key("Escape");
await c.wait(400);
console.log("after Escape open dialogs:", await c.evaluate(`document.querySelectorAll('dialog[open]').length`), "| focus returned to", await active());

// Import details
await c.clickText("More");
await c.wait(200);
await c.clickText("Import detailsFile, method, and review counts");
await c.wait(500);
console.log("import drawer:", await c.evaluate(`document.querySelector('dialog[open]')?.innerText.slice(0, 300)`));
await c.key("Escape");
await c.wait(300);

// Review drawer (non-modal) + Data tab still usable
await c.clickText("More");
await c.wait(200);
await c.evaluate(`[...document.querySelectorAll('[role=menuitem]')][0].click()`);
await c.wait(800);
console.log("review drawer:", await c.evaluate(`(() => { const d = document.querySelector('dialog[open]'); return d ? d.querySelector('h2')?.textContent + ' | modal=' + d.matches(':modal') : null; })()`));
await c.shot(`${R}/after-review-drawer-1440.png`);
await c.key("Escape");
await c.wait(300);
console.log("review closed:", await c.evaluate(`document.querySelectorAll('dialog[open]').length === 0`), "| focus", await active());
c.close();
