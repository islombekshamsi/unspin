import { writeFileSync } from "node:fs";

export async function connect(port = Number(process.env.CDP_PORT ?? 9333), match = process.env.MATCH ?? "localhost") {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && t.url.includes(match)) ?? list.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      const { res, rej } = pending.get(d.id);
      pending.delete(d.id);
      d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result);
    } else listeners.forEach((l) => l(d));
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const viewport = async (width, height, mobile = false) => {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    await send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
  };
  const shot = async (file, full = false) => {
    let params = { format: "png" };
    if (full) {
      const m = await send("Page.getLayoutMetrics");
      const { width, height } = m.cssContentSize ?? m.contentSize;
      params = { ...params, captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.min(height, 6000), scale: 1 } };
    }
    const r = await send("Page.captureScreenshot", params);
    writeFileSync(file, Buffer.from(r.data, "base64"));
    return file;
  };
  const key = async (key, code = key, extra = {}) => {
    const keyCode = { Enter: 13, Escape: 27, Tab: 9, ArrowRight: 39, ArrowLeft: 37, ArrowDown: 40, ArrowUp: 38, F2: 113, Home: 36, End: 35 }[key];
    const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, ...(key === "Enter" ? { text: "\r" } : {}), ...extra };
    await send("Input.dispatchKeyEvent", { type: "keyDown", ...base });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  };
  const type = (text) => send("Input.insertText", { text });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (expr, timeout = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await evaluate(expr)) return true;
      await wait(250);
    }
    throw new Error(`timeout waiting for ${expr}`);
  };
  const clickText = (text, scope = "document") =>
    evaluate(`(() => { const b = [...${scope}.querySelectorAll('button,a,[role=menuitem],[role=tab],summary')].find(e => e.offsetParent !== null && e.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`);
  return { send, evaluate, viewport, shot, key, type, wait, until, clickText, on: (f) => listeners.push(f), close: () => ws.close() };
}
