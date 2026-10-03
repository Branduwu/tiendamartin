import { z } from "zod";
import { UuidSchema } from "./identifiers";

// Length guard also rejects trailing newlines accepted by some UUID regexes.
export const ProductIdSchema = z
  .string()
  .refine((value) => value.length === 36, { abort: true })
  .pipe(UuidSchema);

export const ProductNameSchema = z
  .string()
  .refine((value) => value.length >= 1 && value.length <= 240, {
    abort: true,
    message: "Expected 1–120 Unicode code points",
  })
  .refine(
    (value) =>
      [...value].length <= 120 &&
      value.trim() === value &&
      /[^\p{Cf}\p{M}\p{Z}]/u.test(value) &&
      !/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value) &&
      !/(?:(?![\u200c\u200d])\p{Cf})/u.test(value),
    "Invalid Product name",
  );

export const SkuSchema = z
  .string()
  .refine((value) => value.length >= 1 && value.length <= 64, { abort: true })
  .regex(/^[A-Z0-9](?:[A-Z0-9._-]*[A-Z0-9])?(?![\s\S])/);

export const BarcodeSchema = z
  .string()
  .refine((value) => value.length >= 1 && value.length <= 128, { abort: true })
  .regex(/^[!-~]+(?![\s\S])/);

export const ProductStatusSchema = z.enum(["active", "inactive"]);
