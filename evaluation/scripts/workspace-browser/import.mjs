import { connect } from "./cdp.mjs";

const file = process.argv[2] ?? "wine_data.csv";
const c = await connect();
await c.send("Page.enable");
await c.send("Page.navigate", { url: (process.env.BASE ?? "http://localhost:3000") + "/app" });
await c.until(`!!document.querySelector('input[type=file]')`, 30000);
await c.wait(500);
console.log(
  await c.evaluate(`(async () => { const r = await fetch('http://127.0.0.1:8765/${file}'); const blob = await r.blob(); const f = new File([blob], ${JSON.stringify(file)}, {type: 'text/csv'}); const input = document.querySelector('input[type=file]'); const dt = new DataTransfer(); dt.items.add(f); input.files = dt.files; input.dispatchEvent(new Event('change', {bubbles: true})); return 'uploaded ' + f.size; })()`),
);
await c.until(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Use this selection' && !b.disabled)`, 30000);
console.log("selector:", (await c.evaluate(`document.body.innerText.match(/\\d+ records × \\d+ columns[^\\n]*/)?.[0]`)));
await c.clickText("Use this selection");
await c.until(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Import data' && !b.disabled)`, 30000);
await c.clickText("Import data");
await c.until(`!!document.querySelector('[role=tablist][aria-label=Workspace]')`, 60000);
console.log("workspace:", await c.evaluate("location.href"));
c.close();
