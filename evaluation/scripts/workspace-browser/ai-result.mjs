import { connect } from "./cdp.mjs";

// Shows the finished AI analysis and follows an insight's evidence into the data and source tabs.
const R = "/Users/islomshamsiev/Desktop/unspin/evaluation/results/workspace-redesign";
const c = await connect();
await c.send("Page.bringToFront");
await c.viewport(1440, 900);
const section = `[...document.querySelectorAll('h2')].find(h => h.textContent === 'AI analysis').closest('section')`;
await c.until(`${section}.querySelectorAll('li').length > 0`, 30000);
await c.evaluate(`${section}.scrollIntoView({ block: 'start' })`);
await c.wait(500);
console.log("AI section:", JSON.stringify(await c.evaluate(`${section}.innerText.slice(0, 900)`)));
await c.shot(`${R}/after-ai-analysis-1440.png`);
const clicked = await c.evaluate(`(() => { const b = [...${section}.querySelectorAll('li button')].find(b => b.textContent.trim() === 'Show in data'); if (!b) return false; b.click(); return true; })()`);
await c.wait(1000);
console.log("insight Show in data:", clicked, JSON.stringify(await c.evaluate(`({ tab: document.querySelector('[role=tab][aria-selected=true]')?.textContent, back: [...document.querySelectorAll('button')].find(b => b.textContent.includes('Back to'))?.textContent ?? null, selected: document.querySelectorAll('[role=gridcell][aria-selected=true]').length, rowsSelected: document.querySelectorAll('[role=row][aria-selected=true]').length, status: [...document.querySelectorAll('[role=tabpanel]:not([hidden]) [role=status]')].map(s => s.textContent).join(' / '), hiddenNote: document.querySelector('[role=tabpanel]:not([hidden])')?.innerText.match(/hidden[^\\n]*/)?.[0] ?? null })`)));
await c.clickText("← Back to overview");
await c.wait(500);
console.log("restored scroll near AI section:", await c.evaluate(`Math.round(${section}.getBoundingClientRect().top)`));
c.close();
