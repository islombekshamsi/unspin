import { z } from "zod";

/** Version tag written into every persisted version, export manifest, and extraction request. */
export const CONTRACT_SCHEMA_VERSION = "unspin.contracts/1" as const;

/** Opaque server-generated identifier. Never derived from array positions or filenames. */
export const IdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export type Id = z.infer<typeof IdSchema>;

/** ISO 8601 UTC timestamp, e.g. 2026-10-24T21:30:00.000Z */
export const IsoDateTimeSchema = z.iso.datetime();
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

/**
 * Exact decimal representation. Values are carried as strings so that large
 * integers, identifiers, and trailing precision never pass through JavaScript Number.
 */
export const DecimalStringSchema = z
  .string()
  .regex(/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/, "Expected a canonical decimal string");
export type DecimalString = z.infer<typeof DecimalStringSchema>;

export const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** Normalized rectangle in [0,1], measured from the top-left of the displayed, orientation-corrected source. */
export const NormalizedRectSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  .refine((r) => r.x + r.width <= 1 + 1e-9 && r.y + r.height <= 1 + 1e-9, {
    message: "Region must lie inside the source bounds",
  });
export type NormalizedRect = z.infer<typeof NormalizedRectSchema>;

/** Integer pixel box in a named coordinate system. */
export const PixelBoxSchema = z.object({
  left: z.number().int().min(0),
  top: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type PixelBox = z.infer<typeof PixelBoxSchema>;

/** Box in PDF user-space points (origin bottom-left, unrotated page). */
export const PdfBoxSchema = z.object({
  x0: z.number(),
  y0: z.number(),
  x1: z.number(),
  y1: z.number(),
});
export type PdfBox = z.infer<typeof PdfBoxSchema>;
