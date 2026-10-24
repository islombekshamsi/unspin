import sharp, { type Metadata } from "sharp";
import { AppError, type ImageInfo, type PixelBox } from "@/contracts";
import { LIMITS } from "@/server/config/limits";

const ORIENTATION_SWAPS_AXES = new Set([5, 6, 7, 8]);

/**
 * Reads image facts with sharp and proves the pixels decode. Enforces the decoded
 * pixel cap before decoding (guards decompression bombs).
 */
export async function inspectImage(bytes: Uint8Array, expected: ImageInfo["format"]): Promise<ImageInfo> {
  let meta: Metadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: false }).metadata();
  } catch {
    throw new AppError("unreadable_source", "The image could not be read. It may be damaged or incomplete.");
  }
  const reported: string = meta.format;
  const format = reported === "jpg" ? "jpeg" : reported;
  if (format !== expected) {
    throw new AppError("unsupported_media_type", "The image content does not match its file signature.");
  }
  if ((meta.pages ?? 1) > 1) {
    throw new AppError("unsupported_media_type", "Animated or multi-frame images are not supported. Export a single still frame as PNG, JPEG, or WebP.");
  }
  const width = meta.width;
  const height = meta.height;
  if (!width || !height) throw new AppError("unreadable_source", "The image has no readable dimensions.");
  if (width * height > LIMITS.maxImagePixels) {
    throw new AppError(
      "too_many_pixels",
      `The image is ${width}×${height} pixels; the limit is ${(LIMITS.maxImagePixels / 1_000_000).toFixed(0)} megapixels. Downscale or crop it before uploading.`,
      { details: { width, height, limitPixels: LIMITS.maxImagePixels } },
    );
  }
  const orientation = meta.orientation && meta.orientation >= 1 && meta.orientation <= 8 ? meta.orientation : 1;
  try {
    // Decode fully (cheaply, via shrink-on-load) to prove the pixel data is intact.
    await sharp(bytes, { limitInputPixels: LIMITS.maxImagePixels, failOn: "error" })
      .resize(64, 64, { fit: "inside" })
      .raw()
      .toBuffer();
  } catch {
    throw new AppError("unreadable_source", "The image pixels could not be decoded. The file may be damaged or truncated.");
  }
  const swap = ORIENTATION_SWAPS_AXES.has(orientation);
  return {
    format,
    originalWidth: width,
    originalHeight: height,
    exifOrientation: orientation,
    orientedWidth: swap ? height : width,
    orientedHeight: swap ? width : height,
  };
}

/** Applies EXIF orientation, then cuts the oriented pixel box. Output is lossless PNG. */
export async function cropOrientedRegion(bytes: Uint8Array, box: PixelBox): Promise<{ png: Uint8Array; width: number; height: number }> {
  const { data, info } = await sharp(bytes, { limitInputPixels: LIMITS.maxImagePixels, failOn: "error" })
    .rotate()
    .extract({ left: box.left, top: box.top, width: box.width, height: box.height })
    .png()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== box.width || info.height !== box.height) {
    throw new AppError("internal", "The cropped region did not have the expected size.");
  }
  return { png: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
}
