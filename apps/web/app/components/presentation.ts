export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Mexico_City",
  });
}

/** Display labels only; stored unit codes and quantities remain unchanged. */
export function unitLabel(
  unit: import("@smartretail/contracts").UnitCodeDto,
  milliUnits?: string,
): string {
  return {
    piece: milliUnits === "1000" ? "pieza" : "piezas",
    kg: "kg",
    g: "g",
    l: "L",
    ml: "ml",
    m: "m",
    cm: "cm",
  }[unit];
}
