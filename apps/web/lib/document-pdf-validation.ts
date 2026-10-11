import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { DOCUMENT_LIMITS } from "./document-proposal";
import { preflightPdf } from "./document-preflight";

// Constant code; document bytes are workerData, never evaluated as JavaScript.
const workerSource = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const { getDocument } = await import(workerData.module);
  const task = getDocument({ data: workerData.bytes, enableXfa: false, useWorkerFetch: false,
    disableFontFace: true, useSystemFonts: true, stopAtErrors: true, verbosity: 0,
    maxImageSize: workerData.pixels });
  try {
    const doc = await task.promise;
    if (doc.numPages < 1 || doc.numPages > workerData.pages) throw Error('pages');
    for(let i=1;i<=doc.numPages;i++) {
      const page = await doc.getPage(i), size = page.getViewport({scale:1});
      if(!Number.isFinite(size.width*size.height) || size.width<=0 || size.height<=0 ||
        size.width*size.height>workerData.pixels) throw Error('dimensions');
      page.cleanup();
    }
    parentPort.postMessage({pages:doc.numPages});
  } finally { await task.destroy(); }
})().catch(() => parentPort.postMessage({invalid:true}));
`;
let active = 0;
/** Bound parser lifetime and V8 heap; input byte limit remains a separate check. */
export async function validatedPdfPages(bytes: Uint8Array): Promise<number> {
  preflightPdf(bytes);
  if (active >= 2) throw new TypeError("PDF validator busy");
  const packageRequire = createRequire(import.meta.url),
    resolve = packageRequire.resolve.bind(packageRequire);
  const moduleUrl = pathToFileURL(
    resolve("pdfjs-dist/legacy/build/pdf.mjs"),
  ).href;
  return new Promise<number>((accept, reject) => {
    active++;
    let worker: Worker;
    try {
      worker = new Worker(workerSource, {
        eval: true,
        execArgv: [],
        workerData: {
          bytes: Uint8Array.from(bytes),
          module: moduleUrl,
          pages: DOCUMENT_LIMITS.pages,
          pixels: DOCUMENT_LIMITS.pixels,
        },
        resourceLimits: {
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 16,
        },
        stdout: true,
        stderr: true,
      });
    } catch {
      active--;
      reject(new TypeError("PDF validator unavailable"));
      return;
    }
    // No parser warnings or document contents in application logs.
    worker.stdout?.resume();
    worker.stderr?.resume();
    let settled = false;
    const finish = (pages?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().then(
        () => {
          active--;
          if (pages === undefined) reject(new TypeError("Invalid PDF content"));
          else accept(pages);
        },
        () => {
          active--;
          reject(new TypeError("PDF validator unavailable"));
        },
      );
    };
    const timer = setTimeout(() => finish(), 10000);
    worker.once("message", (value: unknown) => {
      if (
        value &&
        typeof value === "object" &&
        "pages" in value &&
        typeof value.pages === "number" &&
        Number.isInteger(value.pages) &&
        value.pages >= 1 &&
        value.pages <= DOCUMENT_LIMITS.pages
      )
        finish(value.pages);
      else finish();
    });
    worker.once("error", () => finish());
    worker.once("exit", () => finish());
  });
}
