import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiErrorBodySchema, AppError, newId, type Owner } from "@/contracts";
import { commitManualEdit, seedDataset, type SeededDataset } from "../helpers/fixtures";
import { NOAA_SAMPLE, noaaTable } from "../helpers/noaa";
import { makeOwner } from "../helpers/owners";
import { COMMITTED, readInput } from "../helpers/real-inputs";

/**
 * Route handlers called directly. Identity is the only module replaced: next/headers
 * cookies() needs a request scope that vitest does not provide, so resolveOwner()
 * returns a constructed Owner. Cookie behaviour itself is covered by the HTTP smoke
 * script against a running server (tests/smoke/http-smoke.ts).
 */
const identity = vi.hoisted(() => ({ owner: null as Owner | null }));
vi.mock("@/server/identity", () => ({
  GUEST_COOKIE: "unspin_guest",
  resolveOwner: async () => identity.owner,
  currentOwner: async () => identity.owner,
  requireOwner: async () => {
    if (!identity.owner) throw new AppError("not_found", "Not found.");
    return identity.owner;
  },
}));

const { POST: postSources, GET: listSources } = await import("@/app/api/v1/sources/route");
const { GET: getSource, DELETE: deleteSource } = await import("@/app/api/v1/sources/[id]/route");
const { GET: getContent } = await import("@/app/api/v1/sources/[id]/content/route");
const { POST: postSelections } = await import("@/app/api/v1/selections/route");
const { POST: postExtractions } = await import("@/app/api/v1/extractions/route");
const { GET: getJobRoute } = await import("@/app/api/v1/jobs/[id]/route");
const { GET: getDataset } = await import("@/app/api/v1/datasets/[id]/route");
const { GET: getRowsRoute } = await import("@/app/api/v1/datasets/[id]/rows/route");
const { POST: previewRoute } = await import("@/app/api/v1/datasets/[id]/transforms/preview/route");
const { POST: restoreRoute } = await import("@/app/api/v1/datasets/[id]/restore/route");
const { POST: sharesRoute } = await import("@/app/api/v1/datasets/[id]/shares/route");
const { getRepositories } = await import("@/server/storage");

type Ctx = { params: Promise<{ id: string }> };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as Ctx as never;
const url = (path: string) => `http://localhost:3106/api/v1${path}`;
const json = (path: string, body: unknown, method = "POST") =>
  new Request(url(path), { method, headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

async function expectEnvelope(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  const text = await res.text();
  const body = ApiErrorBodySchema.parse(JSON.parse(text));
  expect(body.error.code).toBe(code);
  expect(body.requestId).toMatch(/^req_[a-f0-9]{32}$/);
  // No stack traces, file paths, or internal names.
  expect(text).not.toMatch(/\bat .+\(.*:\d+:\d+\)|node_modules|\/src\/|\.ts:\d+|Error:|AppError/);
  return body;
}

let A: Owner;
let B: Owner;
let s: SeededDataset;
beforeEach(async () => {
  A = makeOwner("a");
  B = makeOwner("b");
  identity.owner = A;
  s = await seedDataset(A, noaaTable(NOAA_SAMPLE));
});
afterEach(() => vi.restoreAllMocks());

describe("malformed and mismatched requests are 400 envelopes", () => {
  it("invalid JSON", async () => {
    const body = await expectEnvelope(await postSelections(json("/selections", "{not json")), 400, "bad_request");
    expect(body.error.message).not.toContain("{not json");
  });

  it("schema mismatch lists bounded issue paths, not the request body", async () => {
    const res = await postSelections(json("/selections", { sourceId: s.source.id, selection: { kind: "image_region", region: { x: 2, y: 0, width: 1, height: 1 } } }));
    const body = await expectEnvelope(res, 400, "bad_request");
    const issues = (body.error.details as { issues: { path: string }[] }).issues;
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.length).toBeLessThanOrEqual(10);
  });

  it("unknown operation type in a transform preview", async () => {
    const res = await previewRoute(json(`/datasets/${s.dataset.id}/transforms/preview`, { expectedVersionId: s.snapshot.version.id, operation: { type: "eval", code: "1" } }), ctx(s.dataset.id));
    await expectEnvelope(res, 400, "bad_request");
  });

  it("rows query with an out-of-range limit", async () => {
    const res = await getRowsRoute(new Request(url(`/datasets/${s.dataset.id}/rows?versionId=${s.snapshot.version.id}&limit=100000`)), ctx(s.dataset.id));
    await expectEnvelope(res, 400, "bad_request");
  });

  it("upload that is not multipart", async () => {
    const res = await postSources(json("/sources", { file: "x" }));
    await expectEnvelope(res, 400, "bad_request");
  });

  it("multipart upload without a 'file' field", async () => {
    const fd = new FormData();
    fd.set("other", "x");
    await expectEnvelope(await postSources(new Request(url("/sources"), { method: "POST", body: fd })), 400, "bad_request");
  });
});

describe("size limit", () => {
  it("a declared content-length above the limit is 413 before the body is read", async () => {
    const req = new Request(url("/sources"), {
      method: "POST",
      headers: { "content-length": String(11 * 1024 * 1024), "content-type": "multipart/form-data; boundary=x" },
      body: "--x--",
    });
    const body = await expectEnvelope(await postSources(req), 413, "payload_too_large");
    expect(body.error.details).toMatchObject({ limitBytes: 10 * 1024 * 1024 });
  });

  it("an actual file above the limit is 413 even without a truthful content-length", async () => {
    const fd = new FormData();
    // Protocol bytes (not data): 10 MiB + 1 byte of zeros.
    fd.set("file", new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.csv", { type: "text/csv" }));
    const req = new Request(url("/sources"), { method: "POST", body: fd });
    await expectEnvelope(await postSources(req), 413, "payload_too_large");
  });
});

describe("unknown and foreign ids are 404 without enumeration", () => {
  it.each([
    ["GET /sources/:id", (id: string) => getSource(new Request(url(`/sources/${id}`)), ctx(id))],
    ["GET /sources/:id/content", (id: string) => getContent(new Request(url(`/sources/${id}/content`)), ctx(id))],
    ["DELETE /sources/:id", (id: string) => deleteSource(new Request(url(`/sources/${id}`), { method: "DELETE" }), ctx(id))],
  ])("%s", async (_n, call) => {
    const missing = await expectEnvelope(await call(newId("src")), 404, "not_found");
    identity.owner = B;
    const foreign = await expectEnvelope(await call(s.source.id), 404, "not_found");
    expect(foreign.error).toEqual(missing.error);
  });

  it("GET /datasets/:id, /rows, /jobs/:id", async () => {
    identity.owner = B;
    await expectEnvelope(await getDataset(new Request(url(`/datasets/${s.dataset.id}`)), ctx(s.dataset.id)), 404, "not_found");
    await expectEnvelope(
      await getRowsRoute(new Request(url(`/datasets/${s.dataset.id}/rows?versionId=${s.snapshot.version.id}`)), ctx(s.dataset.id)),
      404,
      "not_found",
    );
    await expectEnvelope(await getJobRoute(new Request(url(`/jobs/${newId("job")}`)), ctx(newId("job"))), 404, "not_found");
  });

  it("POST /selections and /extractions for a foreign source/selection", async () => {
    identity.owner = B;
    await expectEnvelope(
      await postSelections(json("/selections", { sourceId: s.source.id, selection: { kind: "csv_records", delimiter: ",", headerRecordCount: 1, selectedColumnIndexes: null, recordInterval: null } })),
      404,
      "not_found",
    );
    await expectEnvelope(await postExtractions(json("/extractions", { selectionId: s.selection.id, consentToExternalProcessing: false })), 404, "not_found");
  });

  it("listing sources only shows the caller's", async () => {
    identity.owner = B;
    const res = await listSources();
    const body = (await res.json()) as { sources: { id: string }[] };
    expect(body.sources.map((x) => x.id)).not.toContain(s.source.id);
  });
});

describe("stale versions over HTTP", () => {
  it("restore with a stale expectedVersionId is 409 with currentVersionId", async () => {
    const v2 = await commitManualEdit(A, s, s.snapshot, 0, s.columns[3].id, "330.00");
    const res = await restoreRoute(json(`/datasets/${s.dataset.id}/restore`, { expectedVersionId: s.snapshot.version.id, targetVersionId: s.snapshot.version.id }), ctx(s.dataset.id));
    const body = await expectEnvelope(res, 409, "version_conflict");
    expect(body.error.details).toEqual({ currentVersionId: v2.version.id });
    expect(body.error.retryable).toBe(false);
  });
});

describe("unexpected failures are masked", () => {
  it("a non-AppError with secret-looking text becomes a generic 500 without the text in body or logs", async () => {
    const secret = "postgres://unspin:hunter2-SECRET@db.internal:5432/unspin";
    vi.spyOn(getRepositories().datasets, "get").mockRejectedValue(new Error(`connect failed ${secret}`));
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    const res = await getDataset(new Request(url(`/datasets/${s.dataset.id}`)), ctx(s.dataset.id));
    const body = await expectEnvelope(res, 500, "internal");
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(logs.join("\n")).not.toContain("hunter2");
    expect(body.error.retryable).toBe(true);
  });
});

describe("source content download", () => {
  it("is private, sandboxed, and downloads CSV as an attachment with a safe filename", async () => {
    const res = await getContent(new Request(url(`/sources/${s.source.id}/content`)), ctx(s.source.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(readInput(COMMITTED.noaaCo2Excerpt));
  });

  it("a hostile filename cannot break out of the Content-Disposition header", async () => {
    const t = await seedDataset(A, { ...noaaTable([[2021, 1]]), filename: 'x".csv\r\nSet-Cookie: a=b; ü.csv' });
    const res = await getContent(new Request(url(`/sources/${t.source.id}/content`)), ctx(t.source.id));
    const cd = res.headers.get("content-disposition")!;
    expect(cd).not.toMatch(/[\r\n]/);
    expect(cd.match(/filename="([^"]*)"/)![1]).not.toContain('"');
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("unavailable capabilities are honest", () => {
  it("sharing is 503 not_configured without durable storage, not a fabricated share", async () => {
    const res = await sharesRoute(json(`/datasets/${s.dataset.id}/shares`, { versionId: s.snapshot.version.id }), ctx(s.dataset.id));
    await expectEnvelope(res, 503, "not_configured");
  });
});
