import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HealthSchema } from "@/contracts";
import { getHealth } from "@/server/orchestration/health";

/**
 * Canary values are planted only in process.env for this test process; they are
 * not real credentials. The assertion is that no secret-bearing variable's value
 * reaches the health payload in any configuration.
 */
const CANARIES = {
  GEMINI_API_KEY: "AIzaQA-CANARY-gemini-key-000000000000000",
  DATABASE_URL: "postgres://qa:CANARY-db-password@127.0.0.1:5999/qa",
  AUTH0_CLIENT_SECRET: "CANARY-auth0-client-secret",
  AUTH0_SECRET: "CANARY-auth0-cookie-secret",
  UNSPIN_S3_SECRET_ACCESS_KEY: "CANARY-s3-secret",
  ELEVENLABS_API_KEY: "CANARY-elevenlabs-key",
} as const;
const OTHER = ["GEMINI_MODEL", "AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "APP_BASE_URL", "ELEVENLABS_VOICE_ID"] as const;
const ALL = [...Object.keys(CANARIES), ...OTHER];

const saved: Record<string, string | undefined> = {};
beforeEach(() => ALL.forEach((k) => (saved[k] = process.env[k])));
afterEach(() => ALL.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]))));

function assertNoSecrets(payload: unknown) {
  const text = JSON.stringify(payload);
  for (const v of Object.values(CANARIES)) expect(text).not.toContain(v);
  expect(text).not.toMatch(/CANARY|postgres:\/\/|AIza/);
}

describe("GET /health payload", () => {
  it("with nothing configured: schema-valid booleans, no model id", async () => {
    ALL.forEach((k) => delete process.env[k]);
    const h = HealthSchema.parse(await getHealth());
    expect(h.capabilities.gemini).toEqual({ configured: false, model: null });
    expect(h.capabilities.accounts.configured).toBe(false);
    expect(h.capabilities.narration.configured).toBe(false);
    expect(h.capabilities.persistence.durable).toBe(h.capabilities.persistence.mode === "postgres");
  });

  it("with every secret set: still no secret values, only booleans and an explicit model id", async () => {
    Object.entries(CANARIES).forEach(([k, v]) => (process.env[k] = v));
    process.env.GEMINI_MODEL = "qa-model-id";
    process.env.AUTH0_DOMAIN = "qa.example";
    process.env.AUTH0_CLIENT_ID = "qa-client";
    process.env.APP_BASE_URL = "http://localhost:3106";
    process.env.ELEVENLABS_VOICE_ID = "qa-voice";
    const h = HealthSchema.parse(await getHealth());
    assertNoSecrets(h);
    expect(h.capabilities.accounts.configured).toBe(true);
    expect(h.capabilities.narration.configured).toBe(true);
    // The model id may be shown once extraction is implemented and configured; never the key.
    expect([null, "qa-model-id"]).toContain(h.capabilities.gemini.model);
    expect(h.capabilities.gemini.configured).toBe(h.capabilities.gemini.model !== null);
  });

  it("a key without a model is not 'configured' (model must be explicit)", async () => {
    ALL.forEach((k) => delete process.env[k]);
    process.env.GEMINI_API_KEY = CANARIES.GEMINI_API_KEY;
    const h = await getHealth();
    expect(h.capabilities.gemini).toEqual({ configured: false, model: null });
    assertNoSecrets(h);
  });

  it("limits are the documented guardrails", async () => {
    const h = await getHealth();
    expect(h.limits).toMatchObject({ maxUploadBytes: 10 * 1024 * 1024, maxStructuredRows: 20000, maxColumns: 64, maxExtractedRowsPerRegion: 250 });
    expect(h.limits.acceptedMimeTypes).not.toContain("application/vnd.ms-excel");
    expect(h.limits.acceptedMimeTypes).not.toContain("application/vnd.ms-excel.sheet.macroEnabled.12");
  });
});
