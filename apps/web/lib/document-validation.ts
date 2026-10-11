import sharp from "sharp";
import { DOCUMENT_LIMITS } from "./document-proposal";
import { validatedPdfPages } from "./document-pdf-validation";
import { preflightPdf, preflightImage } from "./document-preflight";

export function documentSignature(bytes: Uint8Array): string | null {
  const header = Buffer.from(bytes);
  if (header.subarray(0, 5).toString("ascii") === "%PDF-")
    return "application/pdf";
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff)
    return "image/jpeg";
  if (
    header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    header.toString("ascii", 0, 4) === "RIFF" &&
    header.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}
export async function validateDocumentBytes(
  bytes: Uint8Array,
  mime: string,
): Promise<{ pages: number; mime: string }> {
  if (
    !bytes.length ||
    bytes.length > DOCUMENT_LIMITS.bytes ||
    documentSignature(bytes) !== mime
  )
    throw new TypeError("Invalid document size or format");
  if (mime === "application/pdf") {
    preflightPdf(bytes);
    return { pages: await validatedPdfPages(bytes), mime };
  }
  preflightImage(bytes, mime);
  try {
    const image = sharp(bytes, {
      limitInputPixels: DOCUMENT_LIMITS.pixels,
      failOn: "error",
    });
    const metadata = await image.metadata();
    const formats = {
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
    };
    if (
      !metadata.format ||
      !(metadata.format in formats) ||
      formats[metadata.format as keyof typeof formats] !== mime ||
      (metadata.pages ?? 1) !== 1
    )
      throw new TypeError("Invalid image format");
    // Decode as well as inspecting the header, catching truncated/invalid image data.
    await image.resize(1, 1).raw().toBuffer();
    return { pages: 1, mime };
  } catch {
    throw new TypeError("Invalid image content");
  }
}
