export const scannerFormats = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "qr_code",
] as const;
export type ScanResult = Readonly<{ value: string; format: string }>;
const detectedFormats: Record<string, string> = {
  ean_13: "EAN13",
  EAN13: "EAN13",
  ean_8: "EAN8",
  EAN8: "EAN8",
  upc_a: "UPCA",
  UPCA: "UPCA",
  upc_e: "UPCE",
  UPCE: "UPCE",
  code_128: "Code128",
  Code128: "Code128",
  code_39: "Code39",
  Code39: "Code39",
  qr_code: "QRCode",
  QRCode: "QRCode",
};
/** Camera results must come from a supported barcode symbology, never plain text. */
export function supportedScan(result: unknown): ScanResult | null {
  if (
    !result ||
    typeof result !== "object" ||
    !("value" in result) ||
    !("format" in result) ||
    !Object.hasOwn(result, "value") ||
    !Object.hasOwn(result, "format") ||
    typeof result.value !== "string" ||
    typeof result.format !== "string"
  )
    return null;
  const format = Object.hasOwn(detectedFormats, result.format)
    ? detectedFormats[result.format]
    : undefined;
  if (!format || !result.value || result.value.length > 2048) return null;
  const digits = (
    { EAN13: 13, EAN8: 8, UPCA: 12, UPCE: 8 } as Record<string, number>
  )[format];
  if (digits && (!/^\d+$/.test(result.value) || result.value.length !== digits))
    return null;
  if (digits && format !== "UPCE") {
    let checksum = 0;
    for (
      let i = result.value.length - 2, weight = 3;
      i >= 0;
      i--, weight = 4 - weight
    ) {
      checksum += Number(result.value.charAt(i)) * weight;
    }
    if ((10 - (checksum % 10)) % 10 !== Number(result.value.slice(-1)))
      return null;
  }
  return { value: result.value, format };
}

export function singleDecodedScan(
  results: readonly ScanResult[],
): ScanResult[] {
  if (results.length !== 1) return [];
  const value = supportedScan(results[0]);
  return value ? [value] : [];
}

/** Three consecutive unambiguous frames; a miss or a different reading resets the streak. */
export function stableScan() {
  let previous: ScanResult | null = null,
    frames = 0;
  return (results: readonly ScanResult[]): ScanResult | null => {
    const next =
      results.length === 1 && results[0] ? supportedScan(results[0]) : null;
    if (!next) {
      previous = null;
      frames = 0;
      return null;
    }
    frames =
      previous?.value === next.value && previous.format === next.format
        ? frames + 1
        : 1;
    previous = next;
    return frames >= 3 ? next : null;
  };
}

/** Matches the centered 80% × 50% guide on an object-fit: cover preview. */
export function cameraScanArea(
  width: number,
  height: number,
  viewWidth: number,
  viewHeight: number,
) {
  const scale = Math.max(viewWidth / width, viewHeight / height);
  const cropWidth = (viewWidth / scale) * 0.8,
    cropHeight = (viewHeight / scale) * 0.5;
  return {
    x: (width - cropWidth) / 2,
    y: (height - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
  };
}
export function scanCode(value: string): string | null {
  // A URL, HTML or unknown QR is displayed as text, never used as a navigation target.
  if (
    !/^[!-~]{1,128}$/.test(value) ||
    /[<>]/.test(value) ||
    /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)
  )
    return null;
  return value;
}
export function cameraMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (["NotAllowedError", "SecurityError"].includes(name))
    return "La cámara no tiene permiso. Puedes permitirla en tu navegador, subir una foto o escribir el código.";
  if (name === "NotFoundError")
    return "No encontramos una cámara. Puedes subir una foto o escribir el código.";
  if (["NotReadableError", "AbortError"].includes(name))
    return "La cámara puede estar ocupada. Cierra otras aplicaciones e intenta de nuevo.";
  return "No pudimos acceder a la cámara. Intenta de nuevo, sube una foto o escribe el código.";
}
export function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
export function imageFileAllowed(file: Pick<File, "size" | "type">): boolean {
  return (
    file.size > 0 &&
    file.size <= 8 * 1024 * 1024 &&
    ["image/jpeg", "image/png", "image/webp"].includes(file.type)
  );
}
