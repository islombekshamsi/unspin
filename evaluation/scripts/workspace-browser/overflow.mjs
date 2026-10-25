import { connect } from "./cdp.mjs";

// Lists the outermost non-SVG elements that extend past the viewport.
const [w = "390", h = "844"] = process.argv.slice(2);
const c = await connect();
await c.send("Page.bringToFront");
await c.viewport(Number(w), Number(h), Number(w) < 700);
await c.wait(1500);
console.log(
  JSON.stringify(
    await c.evaluate(`[...document.querySelectorAll('svg')].filter(s => s.getBoundingClientRect().right > 390 + 1).map(s => ({ cls: String(s.className.baseVal).slice(0, 60), right: Math.round(s.getBoundingClientRect().right), overflow: getComputedStyle(s).overflow, parent: String(s.parentElement.className).slice(0, 80), parentRight: Math.round(s.parentElement.getBoundingClientRect().right) }))`),
  ),
);
console.log(
  JSON.stringify(
    await c.evaluate(`(() => {
      const out = [];
      for (const e of document.body.querySelectorAll('*')) {
        if (e.closest('svg')) continue;
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.right <= 390 + 1) continue;
        const p = e.parentElement;
        if (p && p !== document.body && p.getBoundingClientRect().right > 390 + 1) continue;
        out.push({ tag: e.tagName, cls: String(e.className).slice(0, 110), right: Math.round(r.right), w: Math.round(r.width), pos: getComputedStyle(e).position, text: e.textContent.trim().slice(0, 50) });
      }
      return { sw: document.documentElement.scrollWidth, out: out.slice(0, 10) };
    })()`),
    null,
    1,
  ),
);
c.close();
