import { describe, expect, it } from "vitest";
import {
  scanCode,
  cameraMessage,
  stopCamera,
  imageFileAllowed,
  supportedScan,
  stableScan,
  cameraScanArea,
  singleDecodedScan,
} from "./scanner";
describe("capture input remains data", () => {
  it.each(["7501234567893", "CODE-39", "12345670", "ABC_128", "ABC/123+4"])(
    "accepts an exact product code %s",
    (code) => expect(scanCode(code)).toBe(code),
  );
  it.each([
    "javascript:alert(1)",
    "https://example.com",
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "🧃",
    "\u0000",
    "a".repeat(129),
    "",
    " 123",
  ])("does not execute or look up unknown QR %s", (value) =>
    expect(scanCode(value)).toBeNull(),
  );
  it("stops every track", () => {
    let count = 0;
    const stream = {
      getTracks: () => [{ stop: () => count++ }, { stop: () => count++ }],
    } as unknown as MediaStream;
    stopCamera(stream);
    stopCamera(null);
    expect(count).toBe(2);
  });
  it("has safe permission messages without exception detail", () => {
    const error = new Error("private device detail");
    error.name = "NotAllowedError";
    expect(cameraMessage(error)).toContain("permiso");
    expect(cameraMessage(error)).not.toContain(error.message);
  });
  it("rejects size/type and accepts supported images", () => {
    expect(imageFileAllowed({ size: 100, type: "image/jpeg" })).toBe(true);
    for (const f of [
      { size: 0, type: "image/jpeg" },
      { size: 8 * 1024 * 1024 + 1, type: "image/png" },
      { size: 100, type: "image/svg+xml" },
      { size: 100, type: "text/html" },
    ])
      expect(imageFileAllowed(f)).toBe(false);
  });
});

describe("camera reads barcode symbols deliberately", () => {
  const code = { value: "7501234567893", format: "ean_13" };
  it("does not accept plain numbers without a supported barcode format", () => {
    for (const format of [
      "text",
      "ocr",
      "unknown",
      "",
      "toString",
      "__proto__",
    ]) {
      expect(supportedScan({ value: "12345", format })).toBeNull();
    }
    expect(supportedScan({ value: "12345", format: "ean_13" })).toBeNull();
    expect(supportedScan(code)?.format).toBe("EAN13");
  });
  it("requires three matching frames, not the first fast detection", () => {
    const read = stableScan();
    expect(read([code])).toBeNull();
    expect(read([code])).toBeNull();
    expect(read([code])).toEqual(supportedScan(code));
  });
  it("rejects malformed decoder values and mixed ambiguous frames", () => {
    for (const result of [
      null,
      undefined,
      123,
      { value: 12345, format: "Code128" },
      { value: {}, format: "QRCode" },
      { value: "123", format: null },
      Object.create({ value: "123", format: "Code128" }),
    ]) {
      expect(supportedScan(result)).toBeNull();
    }
    expect(singleDecodedScan([code, { value: "123", format: "text" }])).toEqual(
      [],
    );
    expect(singleDecodedScan([code])).toEqual([supportedScan(code)]);
  });
  it("rejects wrong EAN/UPC-A check digits without restricting numeric Code128", () => {
    for (const [value, format] of [
      ["7501234567893", "EAN13"],
      ["12345670", "EAN8"],
      ["012345678905", "UPCA"],
    ]) {
      expect(supportedScan({ value: value!, format: format! })).not.toBeNull();
      expect(
        supportedScan({ value: value!.slice(0, -1) + "9", format: format! }),
      ).toBeNull();
    }
  });
  it("resets on empty, ambiguous, text or changing readings", () => {
    for (const interruption of [
      [],
      [code, code],
      [{ value: "123", format: "text" }],
      [{ value: "SMOKE-OTHER", format: "Code128" }],
    ]) {
      const read = stableScan();
      read([code]);
      read([code]);
      read(interruption);
      expect(read([code])).toBeNull();
      expect(read([code])).toBeNull();
      expect(read([code])).toEqual(supportedScan(code));
    }
  });
  it("accepts numeric Code128 and QR data as decoded symbols, not OCR", () => {
    expect(supportedScan({ value: "12345", format: "code_128" })).toEqual({
      value: "12345",
      format: "Code128",
    });
    expect(
      supportedScan({ value: "https://example.com", format: "qr_code" })
        ?.format,
    ).toBe("QRCode");
  });
  it("matches the central guide after object-fit cover cropping", () => {
    const area = cameraScanArea(1280, 720, 320, 240);
    expect(area).toEqual({ x: 256, y: 180, width: 768, height: 360 });
    const portrait = cameraScanArea(720, 1280, 320, 240);
    expect(portrait).toEqual({ x: 72, y: 505, width: 576, height: 270 });
  });
});
