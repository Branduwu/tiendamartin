import { DOCUMENT_LIMITS } from "./document-proposal";
import { preflightImage } from "./document-preflight";
import { validateDocumentFile } from "./document-extraction";

// Local camera input is bounded separately; these are never server limits.
export const DOCUMENT_PHOTO_LIMITS = {
  bytes: 12 * 1024 * 1024,
  pixels: 50_000_000,
  side: 12_000,
  outputSide: 2400,
} as const;

let activePreparation: Promise<void> | null = null;
async function preparationSlot(signal: AbortSignal) {
  while (activePreparation) {
    const active = activePreparation;
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      void active.then(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      });
      if (signal.aborted) abort();
    });
    signal.throwIfAborted();
  }
  signal.throwIfAborted();
  let release!: () => void;
  activePreparation = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    activePreparation = null;
    release();
  };
}

export async function prepareDocumentFile(file: File, signal: AbortSignal) {
  signal.throwIfAborted();
  if (file.type === "application/pdf" || /\.xml$/i.test(file.name)) {
    validateDocumentFile(file);
    return { file, optimized: false };
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error(
      "Usa JPEG, PNG, WebP o PDF. No se admiten SVG ni ejecutables.",
    );
  if (!file.size || file.size > DOCUMENT_PHOTO_LIMITS.bytes)
    throw new Error("Usa una foto de hasta 12 MB o un PDF de hasta 4 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  let size: { width: number; height: number };
  try {
    size = preflightImage(bytes, file.type, DOCUMENT_PHOTO_LIMITS.pixels);
    if (Math.max(size.width, size.height) > DOCUMENT_PHOTO_LIMITS.side)
      throw new Error("Image side limit");
  } catch {
    throw new Error("Usa una foto válida de hasta 50 megapíxeles y 12 MB.");
  }
  if (
    file.size <= DOCUMENT_LIMITS.bytes &&
    size.width * size.height <= DOCUMENT_LIMITS.pixels
  ) {
    validateDocumentFile(file);
    return { file, optimized: false };
  }
  // A single resize dimension preserves the decoder's EXIF-oriented aspect ratio.
  // Using the shorter header side also bounds either possible orientation to
  // 2400 px, without relying on a second EXIF parser or allocating a full canvas.
  const scale = Math.min(
    1,
    DOCUMENT_PHOTO_LIMITS.outputSide / Math.max(size.width, size.height),
  );
  const release = await preparationSlot(signal);
  let bitmap: ImageBitmap | undefined, canvas: HTMLCanvasElement | undefined;
  try {
    signal.throwIfAborted();
    bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
      resizeWidth: Math.max(
        1,
        Math.floor(Math.min(size.width, size.height) * scale),
      ),
      resizeQuality: "high",
    });
    signal.throwIfAborted();
    if (
      !bitmap.width ||
      !bitmap.height ||
      bitmap.width * bitmap.height > DOCUMENT_PHOTO_LIMITS.pixels
    )
      throw new Error(
        "No pudimos preparar la foto. Intenta otra o usa carga manual.",
      );
    canvas = document.createElement("canvas");
    const ratio = Math.min(
      1,
      DOCUMENT_PHOTO_LIMITS.outputSide / Math.max(bitmap.width, bitmap.height),
    );
    canvas.width = Math.max(1, Math.floor(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.floor(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No pudimos preparar la foto.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let encoded: Blob | null = null;
    for (const quality of [0.9, 0.8]) {
      signal.throwIfAborted();
      encoded = await new Promise<Blob | null>((resolve) =>
        canvas!.toBlob(resolve, "image/jpeg", quality),
      );
      signal.throwIfAborted();
      if (encoded && encoded.size <= DOCUMENT_LIMITS.bytes) break;
    }
    if (!encoded || !encoded.size || encoded.size > DOCUMENT_LIMITS.bytes)
      throw new Error(
        "La foto sigue siendo demasiado grande. Intenta otra foto.",
      );
    const prepared = new File(
      [encoded],
      file.name.replace(/\.[^.]*$/, "") + ".jpg",
      { type: "image/jpeg" },
    );
    validateDocumentFile(prepared);
    preflightImage(new Uint8Array(await prepared.arrayBuffer()), prepared.type);
    signal.throwIfAborted();
    return { file: prepared, optimized: true };
  } finally {
    bitmap?.close();
    if (canvas) canvas.width = canvas.height = 0;
    release();
  }
}
