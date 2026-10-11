import { DOCUMENT_LIMITS } from "./document-proposal";
export function createDocumentOcrSession(
  signal: AbortSignal,
  progress: (message: string) => void,
) {
  signal.throwIfAborted();
  const worker = new Worker("/document-engine/session-worker.js");
  let rejectCurrent: ((error: Error) => void) | undefined,
    closed = false,
    sequence = 0;
  let failure: Error | undefined;
  const dispose = () => {
    if (closed) return;
    closed = true;
    worker.terminate();
    signal.removeEventListener("abort", abort);
    rejectCurrent?.(new DOMException("Lectura cancelada", "AbortError"));
    rejectCurrent = undefined;
  };
  const abort = () => dispose();
  signal.addEventListener("abort", abort, { once: true });
  worker.onerror = () => {
    failure = new Error(
      "No pudimos leer el documento. Puedes cargarlo manualmente.",
    );
    rejectCurrent?.(failure);
    dispose();
  };
  return {
    dispose,
    async recognize(
      canvas: HTMLCanvasElement,
    ): Promise<{ text: string; confidence: number }> {
      signal.throwIfAborted();
      if (failure) throw failure;
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value
              ? resolve(value)
              : reject(new Error("No pudimos preparar la imagen.")),
          "image/png",
        ),
      );
      signal.throwIfAborted();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      signal.throwIfAborted();
      if (failure) throw failure;
      if (closed) throw new DOMException("Lectura cancelada", "AbortError");
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        rejectCurrent = reject;
        worker.onmessage = ({ data }: MessageEvent<unknown>) => {
          if (
            closed ||
            !data ||
            typeof data !== "object" ||
            !("id" in data) ||
            data.id !== id ||
            !("kind" in data)
          )
            return;
          if (
            data.kind === "progress" &&
            "progress" in data &&
            typeof data.progress === "number" &&
            Number.isFinite(data.progress)
          ) {
            progress(
              `Leyendo documento… ${Math.round(Math.max(0, Math.min(1, data.progress)) * 100)}%`,
            );
            return;
          }
          if (
            data.kind === "result" &&
            "text" in data &&
            typeof data.text === "string" &&
            data.text.length <= DOCUMENT_LIMITS.text &&
            "confidence" in data &&
            typeof data.confidence === "number" &&
            Number.isFinite(data.confidence)
          ) {
            rejectCurrent = undefined;
            resolve({ text: data.text, confidence: data.confidence });
          } else {
            reject(
              new Error(
                "No pudimos leer suficiente información. Intenta otra foto o usa una compra manual.",
              ),
            );
            dispose();
          }
        };
        worker.postMessage({ id, bytes }, [bytes.buffer]);
      });
    },
  };
}
