/** Decimal MXN input, exact string arithmetic; no floating-point conversion. */
export function decimalToMinorUnits(input: string): string {
  if (
    input.length > 128 ||
    !/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?(?![\s\S])/.test(input)
  )
    throw new Error(
      "Usa un importe no negativo con hasta dos decimales, por ejemplo 12.50.",
    );
  const [whole = "", fraction = ""] = input.split(".");
  const minor = `${whole}${fraction.padEnd(2, "0")}`.replace(/^0+(?=\d)/, "");
  if (minor.length > 128) throw new Error("El importe es demasiado largo.");
  return minor;
}
export function minorUnitsToDecimal(minor: string): string {
  if (minor.length > 128 || !/^(0|[1-9][0-9]*)(?![\s\S])/.test(minor))
    throw new Error("Importe inválido.");
  const padded = minor.padStart(3, "0");
  return `${padded.slice(0, -2)}.${padded.slice(-2)}`;
}
