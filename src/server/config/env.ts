/**
 * Server-only environment access. Secret values are returned only to the
 * modules that need them and are never logged or sent to clients.
 * No secret here may use a NEXT_PUBLIC_ prefix.
 */

function read(name: string): string | null {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? null : v.trim();
}

export const APP_VERSION = "0.1.0";

export interface GeminiEnv {
  apiKey: string;
  model: string;
}

/** Gemini is configured only when both the key and an explicit model are present. */
export function geminiEnv(): GeminiEnv | null {
  const apiKey = read("GEMINI_API_KEY");
  const model = read("GEMINI_MODEL");
  if (!apiKey || !model) return null;
  return { apiKey, model };
}

export function geminiStatus(): { keyPresent: boolean; model: string | null } {
  return { keyPresent: read("GEMINI_API_KEY") !== null, model: read("GEMINI_MODEL") };
}

export function databaseUrl(): string | null {
  return read("DATABASE_URL");
}

export type StorageMode = "memory" | "filesystem" | "s3";

export function storageMode(): StorageMode {
  const v = read("UNSPIN_STORAGE_MODE");
  if (v === "filesystem" || v === "s3" || v === "memory") return v;
  return databaseUrl() ? "filesystem" : "memory";
}

/** Private root for filesystem blobs; outside the public/ directory. */
export function storageRoot(): string {
  return read("UNSPIN_STORAGE_ROOT") ?? ".data/blobs";
}

export function jobsMode(): "inline" | "worker" {
  return read("UNSPIN_JOBS_MODE") === "worker" ? "worker" : "inline";
}

export function appOrigin(): string | null {
  return read("APP_BASE_URL");
}

export function s3Env(): {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
} | null {
  const endpoint = read("UNSPIN_S3_ENDPOINT");
  const region = read("UNSPIN_S3_REGION");
  const bucket = read("UNSPIN_S3_BUCKET");
  const accessKeyId = read("UNSPIN_S3_ACCESS_KEY_ID");
  const secretAccessKey = read("UNSPIN_S3_SECRET_ACCESS_KEY");
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, region, bucket, accessKeyId, secretAccessKey };
}

/** Auth0 (nextjs-auth0 v4 variable names). Accounts are optional; guests never need them. */
export function auth0Configured(): boolean {
  return ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "APP_BASE_URL"].every(
    (n) => read(n) !== null,
  );
}

export function elevenLabsConfigured(): boolean {
  return read("ELEVENLABS_API_KEY") !== null && read("ELEVENLABS_VOICE_ID") !== null;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
