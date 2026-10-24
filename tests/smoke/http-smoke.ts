/**
 * Running-server smoke check for /api/v1. Not part of `npm test`.
 *
 *   BASE_URL=http://localhost:3106 npx tsx tests/smoke/http-smoke.ts [--json out.json]
 *
 * Outcomes:
 *   PASS     observed behaviour matches the contract.
 *   BLOCKED  the server honestly reported a capability as not implemented/configured
 *            (503 not_configured) where the contract expects a real result later.
 *   FAIL     anything else. Exit code is 1 when any check FAILs.
 *
 * Inputs: real permitted files from evaluation/inputs (see evaluation/sources.json)
 * plus explicitly labelled protocol bytes (oversized zeros, a truncated PNG header).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiErrorBodySchema, HealthSchema } from "@/contracts";

const BASE = (process.env.BASE_URL ?? "http://localhost:3106").replace(/\/$/, "");
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;

type Outcome = "PASS" | "BLOCKED" | "FAIL";
const results: { check: string; outcome: Outcome; observed: string }[] = [];
const record = (check: string, outcome: Outcome, observed: string) => {
  results.push({ check, outcome, observed });
  console.log(`${outcome.padEnd(7)} ${check} — ${observed}`);
};

class Jar {
  cookies = new Map<string, string>();
  setCookieHeaders: string[] = [];
  header(): Record<string, string> {
    return this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {};
  }
  absorb(res: Response) {
    for (const sc of res.headers.getSetCookie()) {
      this.setCookieHeaders.push(sc);
      const [pair] = sc.split(";");
      const i = pair.indexOf("=");
      this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
}

async function call(jar: Jar | null, path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, { ...init, headers: { ...(jar?.header() ?? {}), ...(init.headers ?? {}) }, redirect: "manual" });
  jar?.absorb(res);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { res, text, body };
}

const LEAK = /\bat .+:\d+:\d+|node_modules|\/src\/|\.tsx?:\d+|AIza[0-9A-Za-z_-]{20,}|\w+:\/\/[^\s"]*:[^\s"]*@|-----BEGIN|sk-[A-Za-z0-9]{20,}/;

function envelope(r: Awaited<ReturnType<typeof call>>) {
  const parsed = ApiErrorBodySchema.safeParse(r.body);
  return parsed.success ? parsed.data : null;
}

function expectError(check: string, r: Awaited<ReturnType<typeof call>>, status: number | number[], blockedOn503 = false) {
  const statuses = Array.isArray(status) ? status : [status];
  const env = envelope(r);
  const cc = r.res.headers.get("cache-control");
  if (LEAK.test(r.text)) return record(check, "FAIL", `response leaks internal detail: ${r.text.slice(0, 160)}`);
  if (!env) return record(check, "FAIL", `HTTP ${r.res.status}, not an error envelope: ${r.text.slice(0, 120)}`);
  if (cc !== "private, no-store") return record(check, "FAIL", `HTTP ${r.res.status} ${env.error.code}, cache-control=${cc}`);
  if (statuses.includes(r.res.status)) return record(check, "PASS", `HTTP ${r.res.status} ${env.error.code}`);
  if (blockedOn503 && r.res.status === 503 && env.error.code === "not_configured") {
    return record(check, "BLOCKED", `HTTP 503 not_configured ("${env.error.message}"); expected ${statuses.join("/")} once implemented`);
  }
  record(check, "FAIL", `expected ${statuses.join("/")}, got HTTP ${r.res.status} ${env.error.code}: ${env.error.message}`);
}

function multipart(bytes: Uint8Array, filename: string, type: string) {
  const fd = new FormData();
  fd.set("file", new File([bytes as Uint8Array<ArrayBuffer>], filename, { type }));
  return fd;
}

const input = (p: string) => new Uint8Array(readFileSync(join(ROOT, p)));

async function main() {
  console.log(`UNSPIN HTTP smoke against ${BASE} at ${new Date().toISOString()}`);

  // Health ------------------------------------------------------------------
  const h = await call(null, "/health");
  const health = HealthSchema.safeParse((h.body as { health?: unknown } | null)?.health);
  if (h.res.status !== 200 || !health.success) record("GET /health shape", "FAIL", `HTTP ${h.res.status} ${h.text.slice(0, 160)}`);
  else
    record(
      "GET /health shape",
      "PASS",
      `status=${health.data.status} gemini.configured=${health.data.capabilities.gemini.configured} persistence=${health.data.capabilities.persistence.mode} durable=${health.data.capabilities.persistence.durable}`,
    );
  record("GET /health exposes no secrets", LEAK.test(h.text) ? "FAIL" : "PASS", LEAK.test(h.text) ? "secret-like pattern found" : "no key/connection-string patterns");
  record("GET /health cache-control", h.res.headers.get("cache-control") === "private, no-store" ? "PASS" : "FAIL", String(h.res.headers.get("cache-control")));

  // Uploads -----------------------------------------------------------------
  const A = new Jar();
  const B = new Jar();
  expectError("POST /sources JSON body (not multipart)", await call(A, "/sources", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), 400);
  const noFile = new FormData();
  noFile.set("other", "x");
  expectError("POST /sources multipart without file", await call(A, "/sources", { method: "POST", body: noFile }), 400);
  // Protocol bytes: 10 MiB + 1 zero bytes.
  expectError(
    "POST /sources oversized (10 MiB + 1)",
    await call(A, "/sources", { method: "POST", body: multipart(new Uint8Array(10 * 1024 * 1024 + 1), "big.csv", "text/csv") }),
    413,
  );
  expectError(
    "POST /sources legacy .xls (real EIA file)",
    await call(A, "/sources", { method: "POST", body: multipart(input("evaluation/inputs/eia-pet-weekly-retail-gasoline-EMM_EPMR_PTE_NUS_DPGw.xls"), "EMM_EPMR_PTE_NUS_DPGw.xls", "application/vnd.ms-excel") }),
    415,
    true,
  );
  expectError(
    "POST /sources legacy .xls renamed .xlsx",
    await call(A, "/sources", {
      method: "POST",
      body: multipart(input("evaluation/inputs/eia-pet-weekly-retail-gasoline-EMM_EPMR_PTE_NUS_DPGw.xls"), "prices.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    }),
    415,
    true,
  );
  // Protocol bytes: first 200 bytes of the real NOAA PNG (truncated image).
  expectError(
    "POST /sources truncated PNG",
    await call(A, "/sources", { method: "POST", body: multipart(input("evaluation/inputs/noaa-gml-co2-trend-mlo-2026-10-09.png").slice(0, 200), "truncated.png", "image/png") }),
    [415, 422, 400],
    true,
  );
  expectError("POST /sources empty file", await call(A, "/sources", { method: "POST", body: multipart(new Uint8Array(0), "empty.csv", "text/csv") }), [400, 415, 422], true);

  const csv = input("evaluation/inputs/noaa-gml-co2-mm-mlo-1974-05_2026-09.excerpt.csv");
  const up = await call(A, "/sources", { method: "POST", body: multipart(csv, "noaa-gml-co2-mm-mlo-1974-05_2026-09.excerpt.csv", "text/csv") });
  let sourceId: string | null = null;
  if (up.res.status === 201) {
    const src = (up.body as { source: { id: string; sha256: string; kind: string } }).source;
    sourceId = src.id;
    record("POST /sources real NOAA CSV", src.kind === "csv" && src.sha256 === "a653f1af074f08f25f7b51e97d4b93b2e5485269a10a11df167e73e5cd7e6fad" ? "PASS" : "FAIL", `201 kind=${src.kind} sha256=${src.sha256.slice(0, 12)}…`);
  } else expectError("POST /sources real NOAA CSV", up, 201, true);

  // Cookie identity and isolation --------------------------------------------
  await call(B, "/sources");
  const ca = A.cookies.get("unspin_guest");
  const cb = B.cookies.get("unspin_guest");
  const sc = A.setCookieHeaders.find((s) => s.startsWith("unspin_guest=")) ?? "";
  record(
    "guest cookie issued per client",
    ca && cb && ca !== cb && /^[A-Za-z0-9_-]{43}$/.test(ca) ? "PASS" : "FAIL",
    `A=${ca ? "set" : "missing"} B=${cb ? "set" : "missing"} distinct=${ca !== cb}`,
  );
  record(
    "guest cookie attributes",
    /HttpOnly/i.test(sc) && /SameSite=lax/i.test(sc) && /Path=\//i.test(sc) ? "PASS" : "FAIL",
    sc.replace(/unspin_guest=[^;]+/, "unspin_guest=<redacted>"),
  );
  const listA = await call(A, "/sources");
  const listB = await call(B, "/sources");
  const idsA = ((listA.body as { sources?: { id: string }[] })?.sources ?? []).map((s) => s.id);
  const idsB = ((listB.body as { sources?: { id: string }[] })?.sources ?? []).map((s) => s.id);
  if (sourceId) {
    record("A lists its own source", idsA.includes(sourceId) ? "PASS" : "FAIL", `A sees ${idsA.length} source(s)`);
    record("B cannot list A's source", !idsB.includes(sourceId) ? "PASS" : "FAIL", `B sees ${idsB.length} source(s)`);
    const bGet = await call(B, `/sources/${sourceId}`);
    expectError("B GET A's source id is 404", bGet, 404);
    const bContent = await call(B, `/sources/${sourceId}/content`);
    expectError("B GET A's source content is 404", bContent, 404);
    const bDel = await call(B, `/sources/${sourceId}`, { method: "DELETE" });
    expectError("B DELETE A's source is 404", bDel, 404);
    const aGet = await call(A, `/sources/${sourceId}`);
    record("A still reads its source after B's attempts", aGet.res.status === 200 ? "PASS" : "FAIL", `HTTP ${aGet.res.status}`);
  } else {
    record("cross-jar source isolation", "BLOCKED", "no source could be created (upload validation not implemented); only empty-list isolation checked");
    record("each jar lists no foreign sources", idsA.length === 0 && idsB.length === 0 ? "PASS" : "FAIL", `A=${idsA.length} B=${idsB.length}`);
  }
  const fakeId = "src_00000000000000000000000000000000";
  const missA = envelope(await call(A, `/sources/${fakeId}`));
  expectError("unknown source id is 404", await call(B, `/sources/${fakeId}`), 404);
  record("404 bodies identical in shape across owners", missA?.error.code === "not_found" ? "PASS" : "FAIL", String(missA?.error.code));

  // Forged cookie -----------------------------------------------------------
  const forged = new Jar();
  forged.cookies.set("unspin_guest", "..%2F..%2Fforged");
  await call(forged, "/sources");
  const reissued = forged.cookies.get("unspin_guest") ?? "";
  record("malformed guest cookie is replaced, not trusted", /^[A-Za-z0-9_-]{43}$/.test(reissued) ? "PASS" : "FAIL", reissued ? "new capability issued" : "no new cookie");

  // JSON endpoints ----------------------------------------------------------
  expectError("POST /selections malformed JSON", await call(A, "/selections", { method: "POST", headers: { "content-type": "application/json" }, body: "{bad" }), 400);
  expectError(
    "POST /selections unknown source",
    await call(A, "/selections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: fakeId, selection: { kind: "csv_records", delimiter: ",", headerRecordCount: 1, selectedColumnIndexes: null, recordInterval: null } }),
    }),
    404,
  );
  expectError("POST /extractions schema mismatch", await call(A, "/extractions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ selectionId: 5 }) }), 400);
  expectError("GET /jobs/:unknown", await call(A, "/jobs/job_00000000000000000000000000000000"), 404);
  expectError("GET /datasets/:unknown", await call(A, "/datasets/ds_00000000000000000000000000000000"), 404);
  expectError("GET /datasets/:id with invalid id characters", await call(A, "/datasets/..%2F..%2Fetc"), [404, 400]);
  expectError("POST /datasets/:id/shares (sharing unavailable)", await call(A, "/datasets/ds_00000000000000000000000000000000/shares", { method: "POST" }), 503);

  const counts = { PASS: 0, BLOCKED: 0, FAIL: 0 } as Record<Outcome, number>;
  results.forEach((r) => (counts[r.outcome] += 1));
  console.log(`\nSummary: ${counts.PASS} pass, ${counts.BLOCKED} blocked, ${counts.FAIL} fail`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ base: BASE, at: new Date().toISOString(), counts, results }, null, 2));
  process.exitCode = counts.FAIL > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error(`smoke aborted: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 2;
});
