import { appendFileSync } from "node:fs";
import { connect } from "./cdp.mjs";

const out = "/tmp/unspin-files/console.log";
const c = await connect();
c.on((d) => {
  if (d.method === "Runtime.consoleAPICalled" && ["error", "warning", "warn", "assert"].includes(d.params.type)) {
    appendFileSync(out, `${new Date().toISOString()} console.${d.params.type}: ${d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 600)}\n`);
  }
  if (d.method === "Runtime.exceptionThrown") {
    appendFileSync(out, `${new Date().toISOString()} exception: ${(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 600)}\n`);
  }
  if (d.method === "Log.entryAdded" && ["error", "warning"].includes(d.params.entry.level)) {
    appendFileSync(out, `${new Date().toISOString()} log.${d.params.entry.level}: ${d.params.entry.text.slice(0, 400)} ${d.params.entry.url ?? ""}\n`);
  }
});
await c.send("Runtime.enable");
await c.send("Log.enable");
appendFileSync(out, `${new Date().toISOString()} logger attached\n`);
