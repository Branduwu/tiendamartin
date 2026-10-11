import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { expect, it } from "vitest";
import { preflightImage, preflightPdf } from "./document-preflight";
const pdf = () =>
  readFile(
    new URL("../../../e2e/fixtures/document-capture/text.pdf", import.meta.url),
  );
it("accepts the simple PDF profile before decoding", async () =>
  expect(() => preflightPdf(awaitValue)).not.toThrow());
const awaitValue = await pdf();
function simplePdf(dictionary: string, extra = "") {
  const header = `%PDF-1.4\n1 0 obj\n<< ${dictionary} >>\nendobj\n${extra}`;
  return new TextEncoder().encode(
    header +
      `xref\n0 2\n0000000000 65535 f \n0000000009 00000 n \ntrailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n${header.length}\n%%EOF\n`,
  );
}
it("explains the conservative rejection of a marker even in literal text", () => {
  expect(() =>
    preflightPdf(
      simplePdf(
        "/Type /Catalog /Title (SMOKE /Prev \\( /ObjStm \\)) /Subject <2F58526566> % /Encrypt\n",
      ),
    ),
  ).toThrow(/incluso si aparecen como texto/);
});
it.each([
  "ObjStm",
  "#4Fbj#53tm",
  "XRef",
  "XRef0",
  "XRef#23candidate",
  "X#52ef9",
  "XRefStm",
  "Prev",
  "Encrypt",
])("rejects %s structural expansion before worker creation", (name) => {
  expect(() => preflightPdf(simplePdf(`/Type /${name}`))).toThrow(
    /estructura comprimida/,
  );
});
it("rejects an escaped structural name terminated by NUL in a valid table", () => {
  expect(() => preflightPdf(simplePdf("/Type /#4FbjStm\x00"))).toThrow(
    /estructura comprimida/,
  );
});
it("does not stop at a stream token nested in a collection", () => {
  expect(() => preflightPdf(simplePdf("/Foo [stream /Prev 1]"))).toThrow(
    /estructura comprimida/,
  );
});
it("inspects an unindexed object even if PDF.js might recover it", () => {
  expect(() =>
    preflightPdf(
      simplePdf("/Type /Catalog", "2 0 obj\n<< /Type /ObjStm >>\nendobj\n"),
    ),
  ).toThrow(/estructura comprimida/);
});
it("requires a traditional cross reference at the declared offset", async () => {
  expect(() =>
    preflightPdf(new TextEncoder().encode("%PDF-1.4\nstartxref\n0\n%%EOF")),
  ).toThrow();
});
it.each(["png", "jpeg", "webp"] as const)(
  "reads %s dimensions before bitmap allocation",
  async (format) => {
    const bytes = await sharp({
      create: { width: 64, height: 48, channels: 3, background: "white" },
    })
      .toFormat(format)
      .toBuffer();
    expect(preflightImage(bytes, `image/${format}`)).toEqual({
      width: 64,
      height: 48,
    });
  },
);
it("rejects excessive PNG dimensions from the header alone", async () => {
  const bytes = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  bytes.writeUInt32BE(50000, 16);
  bytes.writeUInt32BE(50000, 20);
  expect(() => preflightImage(bytes, "image/png")).toThrow();
});
