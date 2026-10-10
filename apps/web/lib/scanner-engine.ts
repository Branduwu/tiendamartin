/// <reference types="emscripten" />
import { scannerFormats, singleDecodedScan, type ScanResult } from "./scanner";
type Detector = {
  detect: (image: ImageData) => Promise<{ rawValue: string; format: string }[]>;
};
type DetectorConstructor = {
  new (options: { formats: readonly string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
};
export async function scannerEngine(): Promise<
  (image: ImageData) => Promise<ScanResult[]>
> {
  const native = (
    globalThis as typeof globalThis & { BarcodeDetector?: DetectorConstructor }
  ).BarcodeDetector;
  if (native) {
    try {
      const supported = await native.getSupportedFormats();
      if (scannerFormats.every((format) => supported.includes(format))) {
        const detector = new native({ formats: scannerFormats });
        return async (image) =>
          singleDecodedScan(
            (await detector.detect(image)).map((r) => ({
              value: r.rawValue,
              format: r.format,
            })),
          );
      }
    } catch {
      /* Unsupported implementations use the local fallback. */
    }
  }
  const reader = await import("zxing-wasm/reader");
  await reader.prepareZXingModule({
    overrides: {
      locateFile: (path) =>
        path.endsWith(".wasm") ? "/scanner-engine/reader.wasm" : path,
    },
    fireImmediately: true,
  });
  return async (image) =>
    singleDecodedScan(
      (
        await reader.readBarcodes(image, {
          formats: [
            "EAN13",
            "EAN8",
            "UPCA",
            "UPCE",
            "Code128",
            "Code39",
            "QRCode",
          ],
          maxNumberOfSymbols: 2,
          tryHarder: true,
        })
      ).map((r) => {
        let value = r.text;
        if (r.format === "UPCE") {
          try {
            const extra: unknown = JSON.parse(r.extra);
            if (
              extra &&
              typeof extra === "object" &&
              "UPCE" in extra &&
              typeof extra.UPCE === "string" &&
              /^\d{8}$/.test(extra.UPCE)
            )
              value = extra.UPCE;
          } catch {
            /* Keep safe decoder text if metadata is absent. */
          }
        }
        return { value, format: r.format };
      }),
    );
}
