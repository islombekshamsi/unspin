import { createHash, createHmac } from "node:crypto";
import { AppError, type BlobStore } from "@/contracts";
import { assertBlobKey } from "./blob-keys";

/**
 * Minimal S3-compatible private object store (PUT/GET/DELETE object) signed with AWS
 * Signature Version 4 using node:crypto and fetch; no SDK dependency. Path-style URLs
 * (`{endpoint}/{bucket}/{key}`), which Vultr Object Storage, MinIO, and AWS accept.
 * Objects are never public: no ACL headers are sent and the bucket must be private.
 * Provider error bodies are never surfaced to callers.
 */

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding per segment, as SigV4 requires for S3 (slashes kept). */
export function encodePath(p: string): string {
  return p
    .split("/")
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

export interface SignInput {
  method: string;
  host: string;
  /** Already-encoded canonical URI path, starting with "/". */
  path: string;
  /** Extra headers to sign (lowercase names), excluding host/x-amz-date/x-amz-content-sha256. */
  headers?: Record<string, string>;
  payloadHash: string;
  amzDate: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Returns the headers to send, including Authorization. */
export function signV4(input: SignInput): Record<string, string> {
  const date = input.amzDate.slice(0, 8);
  const all: Record<string, string> = {
    ...Object.fromEntries(Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()])),
    host: input.host,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": input.amzDate,
  };
  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((n) => `${n}:${all[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [input.method, input.path, "", canonicalHeaders, signedHeaders, input.payloadHash].join("\n");
  const scope = `${date}/${input.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${input.secretAccessKey}`, date);
  const kSigning = hmac(hmac(hmac(kDate, input.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  // fetch derives Host from the URL itself.
  const sendable = { ...all };
  delete sendable.host;
  return {
    ...sendable,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function amzNow(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export class S3BlobStore implements BlobStore {
  private base: URL;

  constructor(
    private cfg: S3Config,
    private fetchImpl: typeof fetch = fetch,
    private timeoutMs = 15_000,
  ) {
    this.base = new URL(cfg.endpoint);
    if (this.base.protocol !== "https:" && this.base.hostname !== "localhost" && this.base.hostname !== "127.0.0.1") {
      throw new AppError("not_configured", "Object storage endpoint must use HTTPS.");
    }
  }

  private async send(method: "PUT" | "GET" | "DELETE" | "HEAD", key: string | null, body?: Uint8Array): Promise<Response> {
    const basePath = this.base.pathname.replace(/\/$/, "");
    const objectPath = key === null ? `/${this.cfg.bucket}` : `/${this.cfg.bucket}/${assertBlobKey(key)}`;
    const path = encodePath(`${basePath}${objectPath}`);
    const payloadHash = sha256Hex(body ?? new Uint8Array());
    const headers = signV4({
      method,
      host: this.base.host,
      path,
      headers: body ? { "content-type": "application/octet-stream" } : {},
      payloadHash,
      amzDate: amzNow(),
      region: this.cfg.region,
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
    });
    try {
      return await this.fetchImpl(`${this.base.origin}${path}`, {
        method,
        headers,
        body: body ? Buffer.from(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new AppError("persistence_unavailable", "Object storage is unreachable.", { retryable: true, cause: e });
    }
  }

  private fail(res: Response): never {
    void res.body?.cancel();
    throw new AppError("persistence_unavailable", `Object storage request failed (HTTP ${res.status}).`, {
      retryable: res.status >= 500 || res.status === 429,
    });
  }

  async put(key: string, bytes: Uint8Array) {
    const res = await this.send("PUT", key, bytes);
    if (!res.ok) this.fail(res);
    void res.body?.cancel();
  }

  async get(key: string) {
    const res = await this.send("GET", key);
    if (res.status === 404) {
      void res.body?.cancel();
      return null;
    }
    if (!res.ok) this.fail(res);
    return new Uint8Array(await res.arrayBuffer());
  }

  async delete(key: string) {
    const res = await this.send("DELETE", key);
    if (!res.ok && res.status !== 404) this.fail(res);
    void res.body?.cancel();
  }

  /** HEAD bucket; never throws. */
  async ready(): Promise<boolean> {
    try {
      const res = await this.send("HEAD", null);
      void res.body?.cancel();
      return res.ok;
    } catch {
      return false;
    }
  }
}
