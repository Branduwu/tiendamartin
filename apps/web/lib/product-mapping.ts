import {
  productId,
  productName,
  sku,
  barcode,
  money,
  type Product,
} from "@smartretail/domain";
import type {
  CreateProductDto,
  UpdateProductDto,
  ProductDto,
} from "@smartretail/contracts";
import type { ProductChanges } from "@smartretail/application";

export function productInput(id: string, dto: CreateProductDto): Product {
  const { barcode: code, ...fields } = dto;
  return {
    ...fields,
    id: productId(id),
    name: productName(dto.name),
    sku: sku(dto.sku),
    ...(code === undefined ? {} : { barcode: barcode(code) }),
    purchaseCost: money(BigInt(dto.purchaseCost.minorUnits)),
    salePrice: money(BigInt(dto.salePrice.minorUnits)),
  };
}
export function productChanges(dto: UpdateProductDto): ProductChanges {
  const { purchaseCost, salePrice, ...fields } = dto;
  return {
    ...fields,
    ...(purchaseCost
      ? { purchaseCost: money(BigInt(purchaseCost.minorUnits)) }
      : {}),
    ...(salePrice ? { salePrice: money(BigInt(salePrice.minorUnits)) } : {}),
  };
}
export function productDto(value: Product): ProductDto {
  return {
    ...value,
    purchaseCost: {
      currency: "MXN",
      minorUnits: value.purchaseCost.minorUnits.toString(),
    },
    salePrice: {
      currency: "MXN",
      minorUnits: value.salePrice.minorUnits.toString(),
    },
  };
}
