import { z } from "zod";

// Internal shared string rule, not a generic domain value object.
export function canonicalIntegerString(field: "minorUnits" | "milliUnits") {
  return (
    z
      .string()
      // Technical transport limit including the sign, not a business limit.
      // Abort before regex evaluation; no bigint conversion occurs here.
      .refine((value) => value.length <= 128, {
        abort: true,
        message: `${field} must not exceed 128 characters`,
      })
      // Absolute end also rejects trailing newlines, unlike `$`.
      .regex(
        /^(?:0|-?[1-9][0-9]*)(?![\s\S])/,
        "Expected a canonical integer string",
      )
  );
}
