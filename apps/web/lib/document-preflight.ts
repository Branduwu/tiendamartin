import { DOCUMENT_LIMITS } from "./document-proposal";
export class DocumentFormatError extends TypeError {}
/** Deliberately conservative PDF profile, inspected over ALL bytes. */
export function preflightPdf(bytes: Uint8Array) {
  if (bytes.length < 8 || bytes.length > DOCUMENT_LIMITS.bytes)
    throw new DocumentFormatError("Usa un PDF de hasta 4 MB.");
  const text = new TextDecoder("latin1").decode(bytes);
  if (!text.startsWith("%PDF-"))
    throw new DocumentFormatError("El archivo no es un PDF válido.");
  // PDF.js recovery can inspect unindexed objects and permissively parse
  // malformed collections. Do not exempt strings, streams or comments using
  // a second, weaker parser. Literal markers are a documented restriction.
  for (const match of text.matchAll(/\/([^\x00\s()[\]{}<>/%]+)/g)) {
    const name = (match[1] ?? "").replace(/#([\da-f]{2})/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
    // PDF.js recovery recognizes /XRef followed by bytes below 64, including
    // suffixes that are not the exact PDF name. Block the entire prefix.
    if (name.startsWith("XRef") || ["ObjStm", "Prev", "Encrypt"].includes(name))
      throw new DocumentFormatError(
        "Este PDF contiene marcadores de estructura comprimida, incremental o protegida no admitidos, incluso si aparecen como texto. Usa una foto o un PDF simple sin estos marcadores.",
      );
  }
  const end = /startxref\s+(\d{1,10})\s+%%EOF\s*$/.exec(text);
  const offset = end ? Number(end[1]) : -1;
  if (
    offset < 0 ||
    offset >= bytes.length ||
    !/^xref\s/.test(text.slice(offset, offset + 8))
  )
    throw new DocumentFormatError(
      "El PDF no tiene una tabla simple válida. Exporta con Imprimir a PDF o usa una foto.",
    );
}
/** Read dimensions from bounded headers before any browser bitmap decode. */
export function preflightImage(
  bytes: Uint8Array,
  mime: string,
  maxPixels: number = DOCUMENT_LIMITS.pixels,
) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0;
  if (
    mime === "image/png" &&
    bytes.length >= 24 &&
    bytes
      .slice(0, 8)
      .every((v, i) => v === [137, 80, 78, 71, 13, 10, 26, 10][i]) &&
    String.fromCharCode(...bytes.slice(12, 16)) === "IHDR"
  ) {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 255) break;
      while (bytes[i] === 255) i++;
      const marker = bytes[i++];
      if (marker === 0xda || marker === 0xd9) break;
      if (i + 2 > bytes.length) break;
      const size = view.getUint16(i);
      if (size < 2 || i + size > bytes.length) break;
      if (
        marker !== undefined &&
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        height = view.getUint16(i + 3);
        width = view.getUint16(i + 5);
        break;
      }
      i += size;
    }
  } else if (
    mime === "image/webp" &&
    bytes.length >= 30 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    const kind = String.fromCharCode(...bytes.slice(12, 16));
    if (kind === "VP8X") {
      width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
      height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
    } else if (kind === "VP8L" && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (
      kind === "VP8 " &&
      bytes[23] === 0x9d &&
      bytes[24] === 1 &&
      bytes[25] === 0x2a
    ) {
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    }
  }
  if (width < 1 || height < 1 || width * height > maxPixels)
    throw new DocumentFormatError(
      "Usa una imagen válida de hasta 12 megapíxeles.",
    );
  return { width, height };
}
