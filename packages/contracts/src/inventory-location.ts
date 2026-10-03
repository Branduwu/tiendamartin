import { z } from "zod";
import { ProductIdSchema, ProductNameSchema } from "./product-fields";

export const InventoryLocationIdSchema = ProductIdSchema;
export const InventoryLocationCodeSchema = z
  .string()
  .refine((value) => value.length >= 1 && value.length <= 32, { abort: true })
  .regex(/^[A-Z0-9](?:[A-Z0-9_-]*[A-Z0-9])?(?![\s\S])/);
export const InventoryLocationNameSchema = z
  .string()
  .refine((value) => value.length <= 200, { abort: true })
  .refine((value) => [...value].length <= 100, { abort: true })
  .pipe(ProductNameSchema);
export const InventoryLocationStatusSchema = z.enum(["active", "inactive"]);

export const InventoryLocationSchema = z.strictObject({
  id: InventoryLocationIdSchema,
  code: InventoryLocationCodeSchema,
  name: InventoryLocationNameSchema,
  status: InventoryLocationStatusSchema,
});
export type InventoryLocationDto = z.infer<typeof InventoryLocationSchema>;
