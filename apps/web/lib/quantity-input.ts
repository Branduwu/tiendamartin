/** Decimal text only: at most three places, no rounding or floating point. */
export function decimalToMilliUnits(input: string, signed = false): string {
  if (
    input.length > 128 ||
    !(
      signed
        ? /^-?(?:0|[1-9]\d*)(?:\.\d{1,3})?$/
        : /^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/
    ).test(input)
  )
    throw new Error("Usa una cantidad sin espacios y con máximo 3 decimales.");
  const negative = input.startsWith("-");
  const [whole = "", fraction = ""] = (negative ? input.slice(1) : input).split(
    ".",
  );
  const result = BigInt(whole + fraction.padEnd(3, "0"));
  return (negative ? -result : result).toString();
}
export function milliUnitsToDecimal(input: string): string {
  const negative = input.startsWith("-");
  const digits = (negative ? input.slice(1) : input).padStart(4, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -3)}.${digits.slice(-3)}`;
}
