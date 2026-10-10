import { expect, it } from "vitest";
import sharp from "sharp";
import { normalizedProductImage } from "./product-image-processing";
it("applies EXIF orientation and strips metadata/trailing content", async () => {
  const input = await sharp({
    create: { width: 12, height: 8, channels: 3, background: "blue" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const r = await normalizedProductImage(
    Buffer.concat([input, Buffer.from("<script>hostile()</script>")]),
    "image/jpeg",
  );
  const m = await sharp(r).metadata();
  expect(m.width).toBe(8);
  expect(m.height).toBe(12);
  expect(m.orientation).toBeUndefined();
  expect(m.exif).toBeUndefined();
  expect(r.includes(Buffer.from("hostile"))).toBe(false);
});
it("re-encodes PNG to bounded JPEG without input EXIF", async () => {
  const input = await sharp({
    create: { width: 1800, height: 1200, channels: 3, background: "red" },
  })
    .png()
    .withMetadata()
    .toBuffer();
  const result = await normalizedProductImage(input, "image/png"),
    m = await sharp(result).metadata();
  expect(m.format).toBe("jpeg");
  expect(m.width).toBe(1600);
  expect(m.exif).toBeUndefined();
  expect(result.length).toBeLessThanOrEqual(1572864);
});
it("rejects executable or SVG content pretending to be JPEG", async () => {
  for (const value of [
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
    "<script>alert(1)</script>",
    "MZ executable",
  ])
    await expect(
      normalizedProductImage(Buffer.from(value), "image/jpeg"),
    ).rejects.toBeInstanceOf(TypeError);
});
it("rejects MIME spoofing and corrupt magic bytes", async () => {
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await expect(
    normalizedProductImage(png, "image/jpeg"),
  ).rejects.toBeInstanceOf(TypeError);
  await expect(
    normalizedProductImage(Buffer.from([255, 216, 255, 0]), "image/jpeg"),
  ).rejects.toBeInstanceOf(TypeError);
});
it("bounds streamed output input before decoding", async () => {
  await expect(
    normalizedProductImage(new Uint8Array(3 * 1024 * 1024 + 1), "image/jpeg"),
  ).rejects.toBeInstanceOf(TypeError);
  await expect(
    normalizedProductImage(new Uint8Array(), "image/jpeg"),
  ).rejects.toBeInstanceOf(TypeError);
});
