import { UuidSchema } from "./identifiers";
import { z } from "zod";
import { MoneySchema } from "./money";
import { UnitCodeSchema } from "./unit";
import {
  ProductIdSchema,
  ProductNameSchema,
  SkuSchema,
  BarcodeSchema,
  ProductStatusSchema,
} from "./product-fields";

// Money remains signed globally. Canonical strings need no BigInt conversion.
const ProductPriceSchema = MoneySchema.refine(
  (value) => !value.minorUnits.startsWith("-"),
  "Product prices must be nonnegative",
);

export const ProductSchema = z.strictObject({
  id: ProductIdSchema,
  name: ProductNameSchema,
  sku: SkuSchema,
  barcode: BarcodeSchema.exactOptional(),
  taxProfileId: UuidSchema.exactOptional(),
  unit: UnitCodeSchema,
  purchaseCost: ProductPriceSchema,
  salePrice: ProductPriceSchema,
  status: ProductStatusSchema,
});

export type ProductDto = z.infer<typeof ProductSchema>;

export const CreateProductSchema = ProductSchema.omit({ id: true });
export const UpdateProductSchema = z
  .strictObject({
    name: ProductNameSchema.exactOptional(),
    sku: SkuSchema.exactOptional(),
    barcode: BarcodeSchema.nullable().exactOptional(),
    taxProfileId: UuidSchema.nullable().exactOptional(),
    unit: UnitCodeSchema.exactOptional(),
    purchaseCost: ProductPriceSchema.exactOptional(),
    salePrice: ProductPriceSchema.exactOptional(),
    status: ProductStatusSchema.exactOptional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one editable field is required",
  );
export type CreateProductDto = z.infer<typeof CreateProductSchema>;
export type UpdateProductDto = z.infer<typeof UpdateProductSchema>;
