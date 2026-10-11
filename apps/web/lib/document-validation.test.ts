import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { expect, it } from "vitest";
import {
  documentSignature,
  validateDocumentBytes,
} from "./document-validation";
import { needsDocumentOcr, validateDocumentFile } from "./document-extraction";
const fixture = async (name: string) =>
  new Uint8Array(
    await readFile(
      new URL(
        `../../../e2e/fixtures/document-capture/${name}`,
        import.meta.url,
      ),
    ),
  );
it("validates an actual bounded image and rejects MIME spoofing", async () => {
  const image = await fixture("invoice.png");
  expect(documentSignature(image)).toBe("image/png");
  expect(await validateDocumentBytes(image, "image/png")).toEqual({
    pages: 1,
    mime: "image/png",
  });
  await expect(validateDocumentBytes(image, "image/jpeg")).rejects.toThrow();
});
it("rejects SVG, executables, truncated images and oversize data", async () => {
  for (const bytes of [
    new TextEncoder().encode("<svg></svg>"),
    new Uint8Array([77, 90]),
    (await fixture("invoice.png")).slice(0, 30),
    new Uint8Array(4194305),
  ])
    await expect(validateDocumentBytes(bytes, "image/png")).rejects.toThrow();
});
it("rejects image decompression beyond the pixel limit", async () => {
  const bytes = await sharp({
    create: { width: 4000, height: 3100, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await expect(validateDocumentBytes(bytes, "image/png")).rejects.toThrow();
});
it("accepts actual text, scanned and bounded multipage PDF", async () => {
  for (const name of [
    "text.pdf",
    "scanned.pdf",
    "multipage.pdf",
    "hostile.pdf",
  ])
    expect(
      (await validateDocumentBytes(await fixture(name), "application/pdf"))
        .pages,
    ).toBe(name === "multipage.pdf" ? 2 : 1);
});
it("rejects malformed and over-limit PDFs", async () => {
  for (const name of ["malformed.pdf", "oversized-pages.pdf"])
    await expect(
      validateDocumentBytes(await fixture(name), "application/pdf"),
    ).rejects.toThrow();
});
it("text layer avoids OCR while absent or insufficient text falls back", () => {
  expect(
    needsDocumentOcr("PROVEEDOR SMOKE Compra arroz 2 piezas total 81.00 MXN"),
  ).toBe(false);
  expect(needsDocumentOcr("")).toBe(true);
  expect(needsDocumentOcr("Page 1")).toBe(true);
  expect(needsDocumentOcr(" ".repeat(500))).toBe(true);
});
it("client rejects XML with a clear deferred fiscal message", () => {
  expect(() =>
    validateDocumentFile({ name: "invoice.xml", size: 100, type: "text/xml" }),
  ).toThrow("XML fiscal");
  expect(() =>
    validateDocumentFile({
      name: "invoice.png",
      size: 4194305,
      type: "image/png",
    }),
  ).toThrow();
  expect(() =>
    validateDocumentFile({
      name: "invoice.svg",
      size: 100,
      type: "image/svg+xml",
    }),
  ).toThrow();
});
