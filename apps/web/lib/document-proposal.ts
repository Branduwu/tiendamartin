import { decimalToMinorUnits } from "./money-input";
import { decimalToMilliUnits } from "./quantity-input";

export const DOCUMENT_LIMITS = Object.freeze({
  bytes: 4 * 1024 * 1024,
  pages: 5,
  pixels: 12_000_000,
  text: 100_000,
  lines: 50,
});
export type Detection = "Detectado" | "Revisar" | "No identificado";
export type ProposedValue = {
  raw: string;
  value: string | null;
  state: Detection;
};
export type DocumentLine = {
  description: string;
  code: string;
  quantity: ProposedValue;
  unit: string | null;
  unitRaw: string;
  cost: ProposedValue;
  amount: ProposedValue;
};
export type DocumentProposal = {
  supplier: string;
  reference: string;
  date: string;
  currency: string;
  subtotal: ProposedValue;
  tax: ProposedValue;
  total: ProposedValue;
  lines: DocumentLine[];
};

/** Ambiguous separators are never guessed. The result is decimal text, not a float. */
export function documentDecimal(raw: string, places: 2 | 3): string | null {
  if (raw.length > 128) return null;
  let value = raw.trim().replace(/^(?:MXN\s*|\$\s*)/i, "");
  if (!value || /[^\d., \u00a0]/u.test(value)) return null;
  const comma = value.includes(","),
    dot = value.includes(".");
  if (comma && dot) {
    const separator =
      value.lastIndexOf(",") > value.lastIndexOf(".") ? "," : ".";
    const group = separator === "," ? "." : ",";
    const parts = value.split(separator);
    if (parts.length !== 2) return null;
    const whole = parts[0] ?? "",
      fraction = parts[1] ?? "";
    if (
      !new RegExp(`^\\d{1,3}(?:\\${group}\\d{3})+$`).test(whole) ||
      !new RegExp(`^\\d{1,${places}}$`).test(fraction)
    )
      return null;
    value = `${whole.split(group).join("")}.${fraction}`;
  } else {
    if (/[ \u00a0]/u.test(value)) {
      const parts = value.split(/[.,]/);
      if (!/^\d{1,3}(?:[ \u00a0]\d{3})+$/u.test(parts[0] ?? "")) return null;
      value = value.replace(/[ \u00a0]/gu, "");
    }
    // A single three-digit suffix could be a thousands group or a quantity decimal.
    if (/^[1-9]\d{0,2}[.,]\d{3}$/.test(value)) return null;
    value = value.replace(",", ".");
  }
  if (!new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${places}})?$`).test(value))
    return null;
  return value;
}
export function detectedAmount(raw: string, quantity = false): ProposedValue {
  const decimal = documentDecimal(raw, quantity ? 3 : 2);
  let value: string | null = null;
  if (decimal !== null) {
    try {
      value = quantity
        ? decimalToMilliUnits(decimal)
        : decimalToMinorUnits(decimal);
    } catch {
      /* Invalid exact amounts remain proposals requiring review. */
    }
  }
  return {
    raw,
    value,
    state: !raw.trim()
      ? "No identificado"
      : value === null
        ? "Revisar"
        : "Detectado",
  };
}
const units: Record<string, string> = {
  pieza: "piece",
  piezas: "piece",
  pza: "piece",
  pzas: "piece",
  piece: "piece",
  kg: "kg",
  kilogramo: "kg",
  kilogramos: "kg",
  g: "g",
  gr: "g",
  l: "l",
  litro: "l",
  litros: "l",
  ml: "ml",
  m: "m",
  cm: "cm",
};
export function normalizedDocumentText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
export function proposeDocument(text: string): DocumentProposal {
  if (text.length > DOCUMENT_LIMITS.text)
    throw new Error("El documento contiene demasiado texto.");
  const rows = text
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean);
  const field = (labels: string) => {
    const pattern = new RegExp(`^(?:${labels})\\s*[:#]?\\s*(.+)$`, "i");
    return (
      rows.map((v) => pattern.exec(v)?.[1]).find((v) => v !== undefined) ?? ""
    );
  };
  const lines: DocumentLine[] = [];
  for (const row of rows) {
    if (row.length > 2048) continue;
    // A bounded, conservative table extractor. Unknown layouts stay available for manual entry.
    let columns = row.split(/\s*\|\s*|\t+|\s{2,}/).map((v) => v.trim());
    if (columns.length < 5) {
      const tail =
        /^(.*?)\s+(\d[\d.,]*)\s+([\p{L}]+)\s+(\$?[\d.,]+)\s+(\$?[\d.,]+)$/u.exec(
          row,
        );
      const head =
        /^(\d[\d.,]*)\s+([\p{L}]+)\s+(.+?)\s+(\$?[\d.,]+)\s+(\$?[\d.,]+)$/u.exec(
          row,
        );
      if (head && units[normalizedDocumentText(head[2] ?? "")])
        columns = [
          head[3] ?? "",
          head[1] ?? "",
          head[2] ?? "",
          head[4] ?? "",
          head[5] ?? "",
        ];
      else if (tail && units[normalizedDocumentText(tail[3] ?? "")])
        columns = [
          tail[1] ?? "",
          tail[2] ?? "",
          tail[3] ?? "",
          tail[4] ?? "",
          tail[5] ?? "",
        ];
      else if (head && tail)
        columns = [
          row,
          `${head[1]} / ${tail[2]}`,
          `${head[2]} / ${tail[3]}`,
          head[4] ?? "",
          head[5] ?? "",
        ];
      else if (head)
        columns = [
          head[3] ?? "",
          head[1] ?? "",
          head[2] ?? "",
          head[4] ?? "",
          head[5] ?? "",
        ];
      else if (tail)
        columns = [
          tail[1] ?? "",
          tail[2] ?? "",
          tail[3] ?? "",
          tail[4] ?? "",
          tail[5] ?? "",
        ];
    }
    if (columns.length < 5 || /^(subtotal|total|impuestos|iva)\b/i.test(row))
      continue;
    const [
      description = "",
      q = "",
      unitRaw = "",
      cost = "",
      amount = "",
      code = "",
    ] = columns;
    if (!description || (!/\d/.test(q) && !/\d/.test(cost))) continue;
    lines.push({
      description: description.slice(0, 200),
      code: code.slice(0, 128),
      quantity: detectedAmount(q, true),
      unitRaw: unitRaw.slice(0, 40),
      unit: units[normalizedDocumentText(unitRaw)] ?? null,
      cost: detectedAmount(cost),
      amount: detectedAmount(amount),
    });
    if (lines.length >= DOCUMENT_LIMITS.lines) break;
  }
  const dateRaw = field("fecha");
  const date =
    /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) &&
    Number.isFinite(Date.parse(`${dateRaw}T00:00:00Z`)) &&
    new Date(`${dateRaw}T00:00:00Z`).toISOString().slice(0, 10) === dateRaw
      ? dateRaw
      : "";
  return {
    supplier: field("proveedor").slice(0, 200),
    reference: field("folio|referencia|nota|factura").slice(0, 100),
    date,
    currency: /\bMXN\b/i.test(text) ? "MXN" : "",
    subtotal: detectedAmount(field("subtotal")),
    tax: detectedAmount(field("impuestos|iva")),
    total: detectedAmount(field("total")),
    lines,
  };
}
/** HALF-UP at the minor unit, matching existing purchase quantity precision. */
export function proposedLineTotal(quantity: string, cost: string): bigint {
  if (!/^\d{1,128}$/.test(quantity) || !/^\d{1,128}$/.test(cost))
    throw new Error("Importe inválido.");
  return (BigInt(quantity) * BigInt(cost) + 500n) / 1000n;
}
export function documentWarnings(
  proposal: DocumentProposal,
  lineNumbers?: readonly number[],
): string[] {
  const warnings: string[] = [];
  let sum = 0n,
    complete = proposal.lines.length > 0;
  for (const [index, line] of proposal.lines.entries()) {
    const lineNumber = lineNumbers?.[index] ?? index + 1;
    if (line.quantity.value === null || line.cost.value === null) {
      complete = false;
      continue;
    }
    const total = proposedLineTotal(line.quantity.value, line.cost.value);
    sum += total;
    if (line.amount.value !== null && total !== BigInt(line.amount.value))
      warnings.push(
        `Línea ${lineNumber}: cantidad × costo no coincide con el importe detectado.`,
      );
    if (line.unit === null)
      warnings.push(`Línea ${lineNumber}: revisa la unidad.`);
  }
  if (
    complete &&
    proposal.subtotal.value !== null &&
    sum !== BigInt(proposal.subtotal.value)
  )
    warnings.push("La suma de líneas no coincide con el subtotal detectado.");
  if (
    proposal.subtotal.value !== null &&
    proposal.tax.value !== null &&
    proposal.total.value !== null &&
    BigInt(proposal.subtotal.value) + BigInt(proposal.tax.value) !==
      BigInt(proposal.total.value)
  )
    warnings.push("Subtotal e impuestos no coinciden con el total detectado.");
  return warnings;
}
export function suggestProducts<
  T extends { name: string; sku: string; barcode?: string; status: string },
>(line: DocumentLine, products: readonly T[]): T[] {
  const active = products.filter((p) => p.status === "active");
  if (line.code) {
    const barcode = active.filter((p) => p.barcode === line.code);
    if (barcode.length) return barcode;
    const sku = active.filter((p) => p.sku === line.code);
    if (sku.length) return sku;
  }
  const description = normalizedDocumentText(line.description);
  if (description.length < 3) return [];
  return active
    .filter((p) => {
      const name = normalizedDocumentText(p.name);
      return name.includes(description) || description.includes(name);
    })
    .slice(0, 5);
}
