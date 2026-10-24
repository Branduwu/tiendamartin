import { expect, it } from "vitest";
import { unitLabel } from "./presentation";
it("shows pieces in Spanish without changing fixed unit codes", () => {
  expect(unitLabel("piece", "1000")).toBe("pieza");
  expect(unitLabel("piece", "2000")).toBe("piezas");
  for (const unit of ["kg", "g", "ml", "m", "cm"] as const)
    expect(unitLabel(unit, "1000")).toBe(unit);
  expect(unitLabel("l")).toBe("L");
});
