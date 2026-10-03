import { z } from "zod";

export const UnitCodeSchema = z.enum([
  "piece",
  "kg",
  "g",
  "l",
  "ml",
  "m",
  "cm",
]);
export type UnitCodeDto = z.infer<typeof UnitCodeSchema>;
