import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { LIMITS } from "@/server/config/limits";
import { validateUpload } from "./index";
import { enc, makePdf, makeZip, pngHeaderOnly } from "./test-support/fixtures";

const v = (bytes: Uint8Array, filename = "file.bin", declaredMimeType: string | null = null) => validateUpload({ bytes, filename, declaredMimeType });

describe("upload signature checks", () => {
  it("rejects executables even when named like a supported file", async () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    await expect(v(exe, "chart.png", "image/png")).rejects.toMatchObject({ code: "unsupported_media_type", message: expect.stringMatching(/executable/) });
    await expect(v(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]), "data.csv")).rejects.toMatchObject({ code: "unsupported_media_type" });
    await expect(v(enc("#!/bin/sh\necho hi\n"), "data.csv")).rejects.toMatchObject({ code: "unsupported_media_type" });
  });

  it("does not mistake text that starts with signature-like letters for binaries", async () => {
    await expect(v(enc("BMI,weight\n21.5,70\n"), "bmi.csv")).resolves.toMatchObject({ kind: "csv" });
    await expect(v(enc("MZ code,count\nA,1\n"), "mz.csv")).resolves.toMatchObject({ kind: "csv" });
  });

  it("rejects archives and non-spreadsheet OOXML", async () => {
    await expect(v(makeZip([{ name: "a.txt", data: "hello" }]), "book.xlsx")).rejects.toMatchObject({ code: "unsupported_media_type", message: expect.stringMatching(/ZIP/) });
    const docx = makeZip([
      { name: "[Content_Types].xml", data: "<Types/>" },
      { name: "word/document.xml", data: "<w/>" },
    ]);
    await expect(v(docx, "book.xlsx")).rejects.toMatchObject({ code: "unsupported_media_type", message: expect.stringMatching(/Word/) });
    await expect(v(new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0]), "x.csv")).rejects.toMatchObject({ code: "unsupported_media_type" });
  });

  it("rejects ZIP entries flagged as encrypted", async () => {
    const z = makeZip([
      { name: "[Content_Types].xml", data: "x", encryptedFlag: true },
      { name: "xl/workbook.xml", data: "x" },
    ]);
    await expect(v(z, "book.xlsx")).rejects.toMatchObject({ code: "encrypted_file" });
  });

  it("rejects legacy XLS and identifies encrypted OOXML in an OLE container", async () => {
    const ole = new Uint8Array(1024);
    ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    ole.set([...Buffer.from("Workbook", "utf16le")], 512);
    await expect(v(ole, "old.xls")).rejects.toMatchObject({ code: "unsupported_media_type", message: expect.stringMatching(/\.xls/) });
    const encrypted = new Uint8Array(1024);
    encrypted.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    encrypted.set([...Buffer.from("EncryptedPackage", "utf16le")], 512);
    await expect(v(encrypted, "locked.xlsx")).rejects.toMatchObject({ code: "encrypted_file" });
  });

  it("rejects unsupported image formats by signature", async () => {
    await expect(v(enc("GIF89a\x01\x00\x01\x00"), "a.png")).rejects.toMatchObject({ code: "unsupported_media_type", message: expect.stringMatching(/GIF/) });
  });

  it("enforces the upload byte limit and rejects empty files", async () => {
    await expect(v(new Uint8Array(LIMITS.maxUploadBytes + 1).fill(0x61))).rejects.toMatchObject({ code: "payload_too_large" });
    await expect(v(new Uint8Array(0))).rejects.toMatchObject({ code: "no_data_found" });
  });
});

describe("image validation", () => {
  it("accepts PNG/JPEG/WebP by content and ignores the declared type", async () => {
    const base = sharp({ create: { width: 3, height: 2, channels: 3, background: "#ff0000" } });
    const png = new Uint8Array(await base.clone().png().toBuffer());
    const jpg = new Uint8Array(await base.clone().jpeg().toBuffer());
    const webp = new Uint8Array(await base.clone().webp().toBuffer());
    await expect(v(png, "x.jpg", "image/jpeg")).resolves.toMatchObject({ kind: "image", mimeType: "image/png", image: { format: "png", originalWidth: 3, originalHeight: 2 } });
    await expect(v(jpg, "x.png")).resolves.toMatchObject({ mimeType: "image/jpeg" });
    await expect(v(webp)).resolves.toMatchObject({ mimeType: "image/webp", processingDisclosure: "gemini_selected_region" });
  });

  it("records EXIF orientation and the oriented dimensions", async () => {
    const jpg = new Uint8Array(await sharp({ create: { width: 40, height: 10, channels: 3, background: "#00ff00" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer());
    const s = await v(jpg);
    expect(s.image).toEqual({ format: "jpeg", originalWidth: 40, originalHeight: 10, exifOrientation: 6, orientedWidth: 10, orientedHeight: 40 });
  });

  it("refuses images over the decoded pixel limit before decoding them", async () => {
    const side = Math.ceil(Math.sqrt(LIMITS.maxImagePixels)) + 1;
    await expect(v(pngHeaderOnly(side, side))).rejects.toMatchObject({ code: "too_many_pixels" });
  });

  it("refuses truncated image data", async () => {
    const png = new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#123456" } }).png().toBuffer());
    await expect(v(png.subarray(0, 60))).rejects.toMatchObject({ code: "unreadable_source" });
  });
});

describe("PDF validation", () => {
  it("counts pages", async () => {
    const pdf = makePdf([
      { mediaBox: [0, 0, 200, 100], content: "" },
      { mediaBox: [0, 0, 200, 100], content: "" },
    ]);
    await expect(v(pdf, "doc.pdf")).resolves.toMatchObject({ kind: "pdf", pageCount: 2, mimeType: "application/pdf" });
  });

  it("refuses password-protected PDFs as encrypted", async () => {
    const pdf = makePdf([{ mediaBox: [0, 0, 200, 100], content: "" }], { encrypt: { userPassword: "secret", ownerPassword: "owner" } });
    await expect(v(pdf, "locked.pdf")).rejects.toMatchObject({ code: "encrypted_file" });
  });

  it("refuses PDFs over the page limit", async () => {
    const pages = Array.from({ length: LIMITS.maxPdfPages + 1 }, () => ({ mediaBox: [0, 0, 10, 10] as [number, number, number, number], content: "" }));
    await expect(v(makePdf(pages), "big.pdf")).rejects.toMatchObject({ code: "payload_too_large", details: { pageCount: LIMITS.maxPdfPages + 1 } });
  });

  it("reports a damaged PDF as unreadable", async () => {
    await expect(v(enc("%PDF-1.4\nthis is not a pdf"), "bad.pdf")).rejects.toMatchObject({ code: "unreadable_source" });
  });
});
