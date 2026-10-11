import { afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { prepareDocumentFile, DOCUMENT_PHOTO_LIMITS } from "./document-photo";
import { preflightImage } from "./document-preflight";

afterEach(() => vi.unstubAllGlobals());
const image = async (width: number, height: number) =>
  new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: "white" } })
      .jpeg()
      .toBuffer(),
  );
const input = async () =>
  new File([await image(4032, 3024)], "iphone.jpeg", { type: "image/jpeg" });
async function browser() {
  const close = vi.fn();
  const bitmap = { width: 1800, height: 2400, close };
  const output = new Blob([await image(1800, 2400)], { type: "image/jpeg" });
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    }),
    toBlob: vi.fn((callback: BlobCallback) => callback(output)),
  };
  const decode = vi.fn<
    (file: Blob, options: ImageBitmapOptions) => Promise<typeof bitmap>
  >(async () => bitmap);
  vi.stubGlobal("createImageBitmap", decode);
  vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
  return { bitmap, canvas, decode, close, output };
}
it("accepts a typical 4032×3024 phone photo, but keeps server preflight strict", async () => {
  const file = await input(),
    b = await browser();
  expect(() =>
    preflightImage(new Uint8Array(awaitValue), "image/jpeg"),
  ).toThrow();
  const prepared = await prepareDocumentFile(
    file,
    new AbortController().signal,
  );
  expect(prepared.optimized).toBe(true);
  expect(prepared.file.type).toBe("image/jpeg");
  expect(prepared.file.name).toBe("iphone.jpg");
  expect(
    preflightImage(
      new Uint8Array(await prepared.file.arrayBuffer()),
      "image/jpeg",
    ),
  ).toEqual({ width: 1800, height: 2400 });
  expect(b.decode.mock.calls[0]?.[1]).toMatchObject({
    imageOrientation: "from-image",
    resizeQuality: "high",
  });
  expect(b.close).toHaveBeenCalledOnce();
  expect(b.canvas.width + b.canvas.height).toBe(0);
});
const awaitValue = await image(4032, 3024);
it("preserves the exact bytes of already bounded images and PDFs", async () => {
  const decode = vi.fn();
  vi.stubGlobal("createImageBitmap", decode);
  for (const file of [
    new File([await image(32, 24)], "small.jpg", { type: "image/jpeg" }),
    new File(["%PDF-"], "sample.pdf", { type: "application/pdf" }),
  ]) {
    const prepared = await prepareDocumentFile(
      file,
      new AbortController().signal,
    );
    expect(prepared).toEqual({ file, optimized: false });
  }
  expect(decode).not.toHaveBeenCalled();
});
it("rejects raw bytes, dimensions and formats before bitmap allocation", async () => {
  const b = await browser();
  const png = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  for (const [w, h] of [
    [10000, 10000],
    [12001, 1],
  ]) {
    const bytes = Buffer.from(png);
    bytes.writeUInt32BE(w!, 16);
    bytes.writeUInt32BE(h!, 20);
    await expect(
      prepareDocumentFile(
        new File([new Uint8Array(bytes)], "huge.png", { type: "image/png" }),
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  }
  for (const file of [
    new File([new Uint8Array(DOCUMENT_PHOTO_LIMITS.bytes + 1)], "large.jpg", {
      type: "image/jpeg",
    }),
    new File(["<svg/>"], "bad.svg", { type: "image/svg+xml" }),
    new File([new Uint8Array(png)], "spoof.jpg", { type: "image/jpeg" }),
    new File(["<xml/>"], "invoice.xml", { type: "text/xml" }),
  ])
    await expect(
      prepareDocumentFile(file, new AbortController().signal),
    ).rejects.toThrow();
  expect(b.decode).not.toHaveBeenCalled();
});
it("cancel during native decode closes its eventual bitmap and produces no file", async () => {
  const b = await browser(),
    abort = new AbortController(),
    file = await input();
  let finish!: (value: typeof b.bitmap) => void;
  b.decode.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = prepareDocumentFile(file, abort.signal);
  await vi.waitFor(() => expect(b.decode).toHaveBeenCalledOnce());
  abort.abort();
  finish(b.bitmap);
  await expect(pending).rejects.toThrow();
  expect(b.close).toHaveBeenCalledOnce();
  expect(b.canvas.toBlob).not.toHaveBeenCalled();
});
it("cancel during encoding clears canvas and discards the result", async () => {
  const b = await browser(),
    abort = new AbortController();
  b.canvas.toBlob.mockImplementationOnce((callback) => {
    abort.abort();
    callback(b.output);
  });
  await expect(
    prepareDocumentFile(await input(), abort.signal),
  ).rejects.toThrow();
  expect(b.close).toHaveBeenCalledOnce();
  expect(b.canvas.width + b.canvas.height).toBe(0);
});
it("a new preparation waits for a cancelled native decode to release its resources", async () => {
  const b = await browser(),
    abort = new AbortController(),
    file = await input();
  let finish!: (value: typeof b.bitmap) => void;
  b.decode.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = prepareDocumentFile(file, abort.signal);
  await vi.waitFor(() => expect(b.decode).toHaveBeenCalledOnce());
  abort.abort();
  const next = prepareDocumentFile(file, new AbortController().signal);
  await Promise.resolve();
  expect(b.decode).toHaveBeenCalledOnce();
  finish(b.bitmap);
  await expect(first).rejects.toThrow();
  expect((await next).optimized).toBe(true);
  expect(b.decode).toHaveBeenCalledTimes(2);
  expect(b.close).toHaveBeenCalledTimes(2);
});
it("encoder failure or over-limit output fails closed and releases resources", async () => {
  for (const output of [
    null,
    new Blob([new Uint8Array(4194305)], { type: "image/jpeg" }),
  ]) {
    const b = await browser();
    b.canvas.toBlob.mockImplementation((callback) => callback(output));
    await expect(
      prepareDocumentFile(await input(), new AbortController().signal),
    ).rejects.toThrow();
    expect(b.close).toHaveBeenCalledOnce();
    expect(b.canvas.width + b.canvas.height).toBe(0);
  }
});
it("does not trust an encoded image above server pixel limits", async () => {
  const b = await browser(),
    invalid = new Blob([await image(4000, 3100)], { type: "image/jpeg" });
  b.canvas.toBlob.mockImplementation((callback) => callback(invalid));
  await expect(
    prepareDocumentFile(await input(), new AbortController().signal),
  ).rejects.toThrow();
  expect(b.close).toHaveBeenCalledOnce();
});
