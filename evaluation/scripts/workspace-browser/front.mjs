import { connect } from "./cdp.mjs";

const c = await connect();
console.log("before:", await c.evaluate("document.visibilityState"));
await c.send("Page.bringToFront");
await c.wait(300);
console.log("after:", await c.evaluate("document.visibilityState"));
c.close();
