import { connect } from "./cdp.mjs";

// usage: node shot.mjs <out.png> <width> <height> [full|viewport] [mobile] [js-before]
const [out, w, h, mode = "viewport", mobile = "", before = ""] = process.argv.slice(2);
const c = await connect();
await c.viewport(Number(w), Number(h), mobile === "mobile");
await c.wait(400);
if (before) console.log("before:", await c.evaluate(before));
await c.wait(600);
console.log(await c.shot(out, mode === "full"));
console.log(
  JSON.stringify(
    await c.evaluate(`({ iw: innerWidth, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, y: scrollY })`),
  ),
);
c.close();
