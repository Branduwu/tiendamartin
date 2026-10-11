// All documents are fictitious. Regenerate with Node; no real invoices or PII.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(new URL("../../../apps/web/package.json", import.meta.url));
const sharp = require("sharp");
export const rows = ["PROVEEDOR: SMOKE Distribuidora", "FOLIO: SMOKE-001", "FECHA: 2026-10-10", "MONEDA: MXN", "SMOKE Arroz | 2 | piece | 25.50 | 51.00", "SMOKE Azucar | 3 | piece | 10.00 | 30.00", "SUBTOTAL: 81.00", "IMPUESTOS: 0.00", "TOTAL: 81.00"];
function pdf(objects) {
  const chunks = [Buffer.from("%PDF-1.4\n")], offsets = [0]; let length = chunks[0].length;
  for (const [i, object] of objects.entries()) {
    offsets.push(length); const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(object) ? object : Buffer.from(object), Buffer.from("\nendobj\n")]); chunks.push(chunk); length += chunk.length;
  }
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(v => String(v).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`)); return Buffer.concat(chunks);
}
function textPdf(pageRows) {
  const pageCount = pageRows.length;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pageRows.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pageCount} >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  for (const [index, rows] of pageRows.entries()) {
    const content = rows.map((v, i) => `BT /F1 16 Tf 40 ${740 - i * 40} Td (${v.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`, `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  return pdf(objects);
}
const out = name => new URL(name, import.meta.url);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1100"><rect width="100%" height="100%" fill="white"/>${rows.map((v, i) => `<text x="60" y="${100 + i * 100}" font-family="Arial" font-size="42" fill="black">${v}</text>`).join("")}</svg>`;
const image = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(out("invoice.png"), image);
writeFileSync(out("tilted.png"), await sharp(image).rotate(5, { background: "white" }).png().toBuffer());
writeFileSync(out("ticket.png"), await sharp(image).resize({ width: 1100 }).png().toBuffer());
// Default phone photo exceeds a strict 12,000,000-pixel cap (12,192,768 px).
writeFileSync(out("iphone-photo.jpg"), await sharp(image).resize(4032, 3024, { fit: "contain", background: "white" }).jpeg({ quality: 95 }).toBuffer());
// Encoded landscape + EXIF rotation represents an upright portrait camera photo.
const cameraPortrait = await sharp(image).resize(3024, 4032, { fit: "contain", background: "white" }).png().toBuffer();
writeFileSync(out("iphone-portrait.jpg"), await sharp(cameraPortrait).rotate(-90).withMetadata({ orientation: 6 }).jpeg({ quality: 95 }).toBuffer());
writeFileSync(out("text.pdf"), textPdf([rows]));
writeFileSync(out("multipage.pdf"), textPdf([rows.slice(0, 5), rows.slice(5)]));
writeFileSync(out("oversized-pages.pdf"), textPdf(Array.from({ length: 6 }, () => rows)));
writeFileSync(out("hostile.pdf"), textPdf([["PROVEEDOR: <script>alert(1)</script>", "https://example.invalid/never-open", "DROP TABLE | 1 | piece | 2.00 | 2.00", "MONEDA: MXN"]]));
writeFileSync(out("malformed.pdf"), "%PDF-1.4\nnot a PDF document");
const jpeg = await sharp(image).jpeg({ quality: 95 }).toBuffer(), command = "q 612 0 0 448 0 200 cm /Im0 Do Q";
writeFileSync(out("scanned.pdf"), pdf(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>", Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1500 /Height 1100 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from("\nendstream")]), `<< /Length ${command.length} >>\nstream\n${command}\nendstream`]));
console.log(`Fictitious capture fixtures generated in ${fileURLToPath(new URL("./", import.meta.url))}`);
