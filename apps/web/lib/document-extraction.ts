import { DOCUMENT_LIMITS } from "./document-proposal";
import { preflightImage, preflightPdf } from "./document-preflight";
import { createDocumentOcrSession } from "./document-ocr-session";

export type Extraction = {
  text: string;
  method: "PDF texto" | "OCR" | "PDF mixto";
  confidence: number | null;
};
export function validateDocumentFile(
  file: Pick<File, "size" | "type" | "name">,
) {
  if (/\.xml$/i.test(file.name))
    throw new Error(
      "XML fiscal no está disponible todavía. Usa una imagen o PDF.",
    );
  if (file.size < 1 || file.size > DOCUMENT_LIMITS.bytes)
    throw new Error("Usa un documento de hasta 4 MB.");
  if (
    !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(
      file.type,
    )
  )
    throw new Error(
      "Usa JPEG, PNG, WebP o PDF. No se admiten SVG ni ejecutables.",
    );
}
export function needsDocumentOcr(text: string) {
  return (
    text.trim().length < 30 || (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 20
  );
}
function check(signal: AbortSignal) {
  signal.throwIfAborted();
}
async function pdfEngine() {
  const pdf = await import("pdfjs-dist");
  pdf.GlobalWorkerOptions.workerSrc = "/document-engine/pdf.worker.min.mjs";
  return pdf;
}
/** Passive raster preview: no PDF viewer, annotations, scripts, attachments or URL actions. */
export async function previewDocument(
  file: File,
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
  pageNumber = 1,
) {
  validateDocumentFile(file);
  check(signal);
  const bytes = new Uint8Array(await file.arrayBuffer());
  check(signal);
  if (file.type !== "application/pdf") {
    preflightImage(bytes, file.type);
    const image = await createImageBitmap(file);
    try {
      check(signal);
      if (image.width * image.height > DOCUMENT_LIMITS.pixels)
        throw new Error("La imagen supera 12 megapíxeles.");
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      canvas.width = Math.ceil(image.width * scale);
      canvas.height = Math.ceil(image.height * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No pudimos preparar el documento.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    } finally {
      image.close();
    }
    return;
  }
  preflightPdf(bytes);
  const pdf = await pdfEngine();
  check(signal);
  const task = pdf.getDocument({
    data: bytes,
    enableXfa: false,
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: true,
    maxImageSize: DOCUMENT_LIMITS.pixels,
  });
  const cancel = () => {
    void task.destroy();
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const doc = await task.promise;
    check(signal);
    if (doc.numPages > DOCUMENT_LIMITS.pages)
      throw new Error("Usa un PDF de hasta 5 páginas.");
    const page = await doc.getPage(pageNumber),
      size = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: Math.min(2, 1600 / Math.max(size.width, size.height)),
    });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    check(signal);
    return doc.numPages;
  } finally {
    signal.removeEventListener("abort", cancel);
    await task.destroy();
  }
}
export async function extractDocument(
  file: File,
  signal: AbortSignal,
  progress: (message: string) => void,
): Promise<Extraction> {
  validateDocumentFile(file);
  check(signal);
  let session: ReturnType<typeof createDocumentOcrSession> | undefined;
  async function ocr(image: HTMLCanvasElement) {
    check(signal);
    if (!session) {
      progress("Preparando lectura en español…");
      session = createDocumentOcrSession(signal, progress);
    }
    const result = await session.recognize(image);
    check(signal);
    return result;
  }
  try {
    if (file.type !== "application/pdf") {
      const canvas = document.createElement("canvas");
      await previewDocument(file, canvas, signal);
      const result = await ocr(canvas);
      canvas.width = canvas.height = 0;
      if (result.text.length > DOCUMENT_LIMITS.text)
        throw new Error("El documento contiene demasiado texto.");
      return { ...result, method: "OCR" };
    }
    const pdf = await pdfEngine();
    check(signal);
    const bytes = new Uint8Array(await file.arrayBuffer());
    preflightPdf(bytes);
    const task = pdf.getDocument({
      data: bytes,
      enableXfa: false,
      useWorkerFetch: false,
      disableFontFace: true,
      useSystemFonts: true,
      maxImageSize: DOCUMENT_LIMITS.pixels,
    });
    const cancelPdf = () => {
      void task.destroy();
    };
    signal.addEventListener("abort", cancelPdf, { once: true });
    try {
      const doc = await task.promise;
      check(signal);
      if (doc.numPages > DOCUMENT_LIMITS.pages)
        throw new Error("Usa un PDF de hasta 5 páginas.");
      const texts: string[] = [];
      let ocrPages = 0,
        confidence: number | null = null;
      for (let index = 1; index <= doc.numPages; index++) {
        progress(`Procesando página ${index} de ${doc.numPages}`);
        check(signal);
        const page = await doc.getPage(index);
        const content = await page.getTextContent();
        let text = "";
        for (const item of content.items) {
          if ("str" in item) text += item.str + (item.hasEOL ? "\n" : "  ");
          if (text.length > DOCUMENT_LIMITS.text)
            throw new Error("El documento contiene demasiado texto.");
        }
        if (needsDocumentOcr(text)) {
          const canvas = document.createElement("canvas"),
            size = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({
            scale: Math.min(2, 1800 / Math.max(size.width, size.height)),
          });
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          if (canvas.width * canvas.height > DOCUMENT_LIMITS.pixels)
            throw new Error("La página es demasiado grande.");
          await page.render({ canvas, viewport }).promise;
          try {
            const result = await ocr(canvas);
            text = result.text;
            confidence = Math.min(confidence ?? 100, result.confidence);
            ocrPages++;
          } finally {
            canvas.width = canvas.height = 0;
          }
        }
        texts.push(text);
        page.cleanup();
        if (texts.join("\n").length > DOCUMENT_LIMITS.text)
          throw new Error("El documento contiene demasiado texto.");
      }
      return {
        text: texts.join("\n"),
        method:
          ocrPages === 0
            ? "PDF texto"
            : ocrPages === doc.numPages
              ? "OCR"
              : "PDF mixto",
        confidence,
      };
    } finally {
      signal.removeEventListener("abort", cancelPdf);
      await task.destroy();
    }
  } finally {
    session?.dispose();
  }
}
