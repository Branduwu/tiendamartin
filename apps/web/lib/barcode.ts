import { CODE128 } from "jsbarcode/bin/barcodes/CODE128/index.js";
/** CODE128-only encoder. Plain object output keeps all DOM creation in React. */
export function barcodePattern(value: string): string {
  if (!/^[!-~]{1,128}(?![\s\S])/.test(value))
    throw new TypeError("Código de barras no representable.");
  const encoder = new CODE128(value, { text: value });
  if (!encoder.valid()) throw new TypeError("Barcode not representable.");
  const result = encoder.encode();
  if (result.text !== value)
    throw new TypeError("Encoded barcode does not match product.");
  const bits = result.data;
  if (!/^[01]+(?![\s\S])/.test(bits))
    throw new TypeError("Código de barras inválido.");
  return bits;
}
export function barcodeBars(
  bits: string,
): readonly { x: number; width: number }[] {
  if (!/^[01]+(?![\s\S])/.test(bits) || bits.length > 2000)
    throw new TypeError("Patrón inválido.");
  return [...bits.matchAll(/1+/g)].map((m) => ({
    x: m.index + 10,
    width: m[0].length,
  }));
}
