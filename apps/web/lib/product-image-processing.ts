import sharp from "sharp";
export async function normalizedProductImage(
  bytes: Uint8Array,
  mime: string,
): Promise<Buffer> {
  if (!bytes.length || bytes.length > 3 * 1024 * 1024)
    throw new TypeError("Invalid image size");
  const header = Buffer.from(bytes);
  const detected =
    header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
      ? "image/jpeg"
      : header
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? "image/png"
        : header.toString("ascii", 0, 4) === "RIFF" &&
            header.toString("ascii", 8, 12) === "WEBP"
          ? "image/webp"
          : null;
  if (!detected || detected !== mime)
    throw new TypeError("Invalid image signature");
  try {
    const input = sharp(bytes, {
      limitInputPixels: 24_000_000,
      failOn: "error",
    });
    const metadata = await input.metadata();
    const accepted = {
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
    };
    if (
      !metadata.format ||
      !(metadata.format in accepted) ||
      accepted[metadata.format as keyof typeof accepted] !== mime ||
      (metadata.pages ?? 1) !== 1
    )
      throw new TypeError("Invalid image content");
    const output = await input
      .rotate()
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "white" })
      .jpeg({ quality: 82 })
      .toBuffer();
    if (output.length > 1572864) throw new TypeError("Encoded image too large");
    return output;
  } catch {
    throw new TypeError("Invalid image content");
  }
}
