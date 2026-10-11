import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { documentOcrWorkerSource } from "../../../lib/document-ocr-worker";
export const runtime = "nodejs";
const cores = new Set(
  [
    "tesseract-core",
    "tesseract-core-lstm",
    "tesseract-core-simd",
    "tesseract-core-simd-lstm",
    "tesseract-core-relaxedsimd",
    "tesseract-core-relaxedsimd-lstm",
  ].flatMap((n) => [`${n}.wasm`, `${n}.wasm.js`]),
);
export async function GET(
  _request: Request,
  context: { params: Promise<{ asset: string[] }> },
) {
  const { asset } = await context.params;
  const resolver = createRequire(import.meta.url);
  const resolve = resolver.resolve.bind(resolver);
  let file: string | undefined;
  const name = asset.join("/");
  if (name === "session-worker.js")
    return new Response(documentOcrWorkerSource, {
      headers: {
        "Content-Type": "text/javascript",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  if (name === "pdf.worker.min.mjs")
    file = join(
      dirname(resolve("pdfjs-dist/package.json")),
      "build/pdf.worker.min.mjs",
    );
  if (name === "ocr-worker.min.js")
    file = join(
      dirname(resolve("tesseract.js/package.json")),
      "dist/worker.min.js",
    );
  if (name === "ocr-library.min.js")
    file = join(
      dirname(resolve("tesseract.js/package.json")),
      "dist/tesseract.min.js",
    );
  if (name === "lang/spa.traineddata.gz")
    file = join(
      dirname(resolve("@tesseract.js-data/spa/package.json")),
      "4.0.0_best_int/spa.traineddata.gz",
    );
  if (asset.length === 2 && asset[0] === "core" && cores.has(asset[1] ?? "")) {
    file = join(dirname(resolve("tesseract.js-core/package.json")), asset[1]!);
  }
  if (!file) return new Response(null, { status: 404 });
  // Fixed asset allowlist above; exact worker/core/model files are explicitly
  // included by next.config.ts. Avoid tracing unrelated project files.
  const bytes = await readFile(/* turbopackIgnore: true */ file);
  return new Response(bytes, {
    headers: {
      "Content-Type": name.endsWith(".wasm")
        ? "application/wasm"
        : name.endsWith(".gz")
          ? "application/octet-stream"
          : "text/javascript",
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
