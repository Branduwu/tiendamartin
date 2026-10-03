const unitCodes = Object.freeze([
  "piece",
  "kg",
  "g",
  "l",
  "ml",
  "m",
  "cm",
] as const);

export type UnitCode = (typeof unitCodes)[number];

// Internal runtime guard; no normalization, aliases or external-input parsing.
export function assertUnitCode(unit: UnitCode): void {
  if (!unitCodes.includes(unit)) {
    throw new TypeError("Expected a supported UnitCode");
  }
}
