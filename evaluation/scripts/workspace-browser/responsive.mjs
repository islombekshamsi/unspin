import { connect } from "./cdp.mjs";

// Captures each tab at several viewport sizes and reports overflow and layout metrics.
const R = "/Users/islomshamsiev/Desktop/unspin/evaluation/results/workspace-redesign";
const sizes = [
  ["1280x720", 1280, 720, false],
  ["820x1180", 820, 1180, true],
  ["390x844", 390, 844, true],
];
const c = await connect();
await c.send("Page.bringToFront");
const tab = (name) => c.evaluate(`[...document.querySelectorAll('[role=tab]')].find(t => t.textContent === '${name}').click()`);
for (const [tag, w, h, mobile] of sizes) {
  await c.viewport(w, h, mobile);
  for (const t of ["Overview", "Data", "Source"]) {
    await tab(t);
    await c.evaluate("window.scrollTo(0, 0)");
    await c.wait(700);
    const m = await c.evaluate(`(() => {
      const wide = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > ${w} + 1 && !e.closest('[class*=overflow-auto], [class*=overflow-x-auto]'); }).slice(0, 4).map(e => e.tagName + '.' + String(e.className).slice(0, 50));
      const chart = document.querySelector('[role=tabpanel]:not([hidden]) .recharts-wrapper, [role=tabpanel]:not([hidden]) svg.recharts-surface');
      const grid = document.querySelector('[role=tabpanel]:not([hidden]) [role=grid]');
      return { sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, overflowing: wide,
        chart: chart ? Math.round(chart.getBoundingClientRect().width) + 'x' + Math.round(chart.getBoundingClientRect().height) : null,
        grid: grid ? Math.round(grid.getBoundingClientRect().width) + 'x' + Math.round(grid.getBoundingClientRect().height) : null };
    })()`);
    console.log(tag, t, JSON.stringify(m));
    await c.shot(`${R}/after-${t.toLowerCase()}-${tag}.png`, t === "Overview" && w < 900);
  }
}
await c.viewport(1440, 900);
await tab("Overview");
c.close();
