import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/contracts";
import { assertBlobKey, newBlobKey } from "./blob-keys";
import { FilesystemBlobStore } from "./blob-fs";
import { S3BlobStore, signV4 } from "./blob-s3";

describe("blob keys", () => {
  it("accepts server-generated keys", () => {
    expect(newBlobKey("guest_abc123", "src_0123abcd")).toBe("sources/guest_abc123/src_0123abcd");
    expect(() => assertBlobKey("sources/guest_x/src_y")).not.toThrow();
  });

  it.each([
    "../etc/passwd",
    "sources/../../etc/passwd",
    "sources/guest/..",
    "sources/guest/.hidden",
    "/sources/guest/src",
    "sources//src",
    "sources/guest/src/",
    "sources\\guest\\src",
    "sources/guest/src%2F..",
    "sources/guest/report.pdf",
    "sources",
    "Sources/guest/src",
    "sources/a/b/c/d",
    "",
  ])("rejects %j", (key) => {
    expect(() => assertBlobKey(key)).toThrow(AppError);
  });

  it("strips anything unsafe from owner/source segments", () => {
    expect(newBlobKey("guest_../x", "src_1/../2")).toBe("sources/guest_x/src_12");
  });
});

describe("FilesystemBlobStore", () => {
  let root: string;
  let store: FilesystemBlobStore;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "unspin-blob-"));
    store = new FilesystemBlobStore(path.join(root, "blobs"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("stores, reads, and deletes private files with restrictive modes", async () => {
    const key = "sources/guest_a/src_1";
    const bytes = new Uint8Array([0, 1, 2, 255]);
    expect(await store.ready()).toBe(true);
    await store.put(key, bytes);
    expect(await store.get(key)).toEqual(bytes);
    const file = store.pathFor(key);
    expect(file.startsWith(path.join(root, "blobs") + path.sep)).toBe(true);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(file))).mode & 0o777).toBe(0o700);
    expect(await readdir(path.dirname(file))).toEqual(["src_1"]);
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
    await store.delete(key);
  });

  it("overwrites atomically", async () => {
    const key = "sources/guest_a/src_2";
    await store.put(key, new Uint8Array([1]));
    await store.put(key, new Uint8Array([2, 2]));
    expect(await store.get(key)).toEqual(new Uint8Array([2, 2]));
    expect(await readdir(path.dirname(store.pathFor(key)))).toEqual(["src_2"]);
  });

  it("rejects traversal keys on every operation without touching the filesystem", async () => {
    for (const key of ["../outside", "sources/../../outside", "sources/a/..", "/abs/path"]) {
      await expect(store.put(key, new Uint8Array([1]))).rejects.toBeInstanceOf(AppError);
      await expect(store.get(key)).rejects.toBeInstanceOf(AppError);
      await expect(store.delete(key)).rejects.toBeInstanceOf(AppError);
    }
    expect(await readdir(root)).toEqual([]);
  });
});

describe("S3 SigV4", () => {
  // AWS S3 API reference, "Signature Calculations for the Authorization Header", Example: GET Object.
  it("matches the published GET Object test vector", () => {
    const headers = signV4({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      headers: { range: "bytes=0-9" },
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      amzDate: "20130524T000000Z",
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    });
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
    expect(headers.host).toBeUndefined();
  });

  it("uses path-style private requests and hides provider error bodies", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const responses = [new Response(null, { status: 200 }), new Response("secret-ish body", { status: 403 }), new Response(null, { status: 404 })];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return responses.shift()!;
    }) as unknown as typeof fetch;
    const s3 = new S3BlobStore(
      { endpoint: "https://ewr1.example-objects.test", region: "ewr1", bucket: "unspin-private", accessKeyId: "AK", secretAccessKey: "SK" },
      fakeFetch,
    );
    await s3.put("sources/guest_a/src_1", new Uint8Array([1, 2]));
    expect(calls[0].url).toBe("https://ewr1.example-objects.test/unspin-private/sources/guest_a/src_1");
    expect(calls[0].init.method).toBe("PUT");
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/ewr1\/s3\/aws4_request/);
    expect(Object.keys(h).some((k) => k.startsWith("x-amz-acl"))).toBe(false);
    const err = await s3.get("sources/guest_a/src_1").catch((e: AppError) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("persistence_unavailable");
    expect((err as AppError).message).not.toContain("secret");
    expect(await s3.get("sources/guest_a/src_2")).toBeNull();
    await expect(s3.get("../x")).rejects.toBeInstanceOf(AppError);
  });

  it("refuses a plaintext remote endpoint", () => {
    expect(
      () => new S3BlobStore({ endpoint: "http://objects.example.test", region: "r", bucket: "b", accessKeyId: "a", secretAccessKey: "s" }),
    ).toThrow(AppError);
  });
});
