import { connect } from "./cdp.mjs";

// Grants analysis consent, starts ONE AI overview, switches tabs while it runs, and counts requests.
const R = "/Users/islomshamsiev/Desktop/unspin/evaluation/results/workspace-redesign";
const c = await connect();
await c.send("Page.bringToFront");
await c.viewport(1440, 900);
const requests = [];
c.on((d) => {
  if (d.method === "Network.requestWillBeSent" && d.params.request.url.includes("/api/")) {
    requests.push(`${d.params.request.method} ${new URL(d.params.request.url).pathname}`);
  }
});
await c.send("Network.enable");
const tab = (name) => c.evaluate(`[...document.querySelectorAll('[role=tab]')].find(t => t.textContent === '${name}').click()`);
const aiText = () => c.evaluate(`(() => { const h = [...document.querySelectorAll('h2')].find(h => h.textContent === 'AI analysis'); return h?.closest('section')?.innerText.slice(0, 700) ?? null; })()`);

await tab("Overview");
await c.wait(500);
if (await c.clickText("Analyze this dataset")) {
  await c.until(`[...document.querySelectorAll('button')].some(b => b.textContent.trim().startsWith('Generate') && !b.disabled)`, 20000);
}
console.log("consent granted; AI section:", JSON.stringify((await aiText())?.slice(0, 200)));
const before = requests.length;
await c.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Generate') && !b.disabled).click()`);
await c.wait(1500);
for (const t of ["Data", "Source", "Overview", "Data", "Overview"]) {
  await tab(t);
  await c.wait(700);
  console.log(`on ${t}: tab-bar status =`, await c.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('AI analysis:'))?.textContent ?? '(none)'`));
}
await tab("Overview");
await c.until(`(() => { const h = [...document.querySelectorAll('h2')].find(h => h.textContent === 'AI analysis'); const s = h?.closest('section'); return s && !s.querySelector('[role=status]') && [...s.querySelectorAll('button')].some(b => b.textContent.trim().startsWith('Generate') && !b.disabled); })()`, 120000);
await c.wait(800);
const during = requests.slice(before);
const tally = during.reduce((m, r) => ((m[r.replace(/[a-z]+_[0-9a-f]{32}/g, ":id")] = (m[r.replace(/[a-z]+_[0-9a-f]{32}/g, ":id")] ?? 0) + 1), m), {});
console.log("API requests after pressing Generate:", JSON.stringify(tally, null, 1));
console.log("AI section after:", JSON.stringify(await aiText()));
await c.evaluate(`[...document.querySelectorAll('h2')].find(h => h.textContent === 'AI analysis').closest('section').scrollIntoView({ block: 'start' })`);
await c.wait(400);
await c.shot(`${R}/after-ai-analysis-1440.png`);
c.close();
