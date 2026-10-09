import { z } from "zod";
import { UuidSchema } from "./identifiers";
import { QuantitySchema } from "./quantity";
import { MoneySchema } from "./money";

const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (v) =>
        v.trim().length > 0 &&
        !/\p{Cs}/u.test(v) &&
        !Array.from(v).some(
          (char) =>
            char.charCodeAt(0) < 32 &&
            ![9, 10, 13].includes(char.charCodeAt(0)),
        ),
    );
export const SupplierFieldsSchema = z.strictObject({
  name: text(200),
  contactName: text(200).optional(),
  phone: text(50).optional(),
  email: z.email().max(254).optional(),
  notes: text(2000).optional(),
  status: z.enum(["active", "inactive"]),
});
export const CreateSupplierSchema = SupplierFieldsSchema.extend({
  id: UuidSchema,
});
export const UpdateSupplierSchema = SupplierFieldsSchema.extend({
  contactName: text(200).nullable().optional(),
  phone: text(50).nullable().optional(),
  email: z.email().max(254).nullable().optional(),
  notes: text(2000).nullable().optional(),
})
  .partial()
  .refine((v) => Object.keys(v).length > 0);
const positiveQuantity = QuantitySchema.refine(
  (q) =>
    q.milliUnits !== "0" &&
    !q.milliUnits.startsWith("-") &&
    (q.unit !== "piece" || /000$/.test(q.milliUnits)),
  "Positive quantity; whole pieces required",
);
const cost = MoneySchema.refine(
  (m) => !m.minorUnits.startsWith("-"),
  "Cost cannot be negative",
);
const draft = z.strictObject({
  supplierId: UuidSchema,
  locationId: UuidSchema,
  notes: z
    .string()
    .max(2000)
    .refine((v) => !v.includes("\u0000") && !/\p{Cs}/u.test(v))
    .optional(),
  lines: z
    .array(
      z.strictObject({
        productId: UuidSchema,
        quantityOrdered: positiveQuantity,
        unitCost: cost,
      }),
    )
    .min(1)
    .max(50),
});
export const CreatePurchaseOrderSchema = draft.extend({ id: UuidSchema });
export const UpdatePurchaseOrderSchema = draft;
export const ReceivePurchaseOrderSchema = z.strictObject({
  id: UuidSchema,
  lines: z
    .array(
      z.strictObject({ productId: UuidSchema, quantity: positiveQuantity }),
    )
    .min(1)
    .max(50),
});
export const PurchaseActionSchema = z.strictObject({});
export type SupplierDto = z.infer<typeof CreateSupplierSchema> & {
  tenantId: string;
  createdAt: string;
};
export type PurchaseOrderDto = Omit<
  z.infer<typeof CreatePurchaseOrderSchema>,
  "lines"
> & {
  tenantId: string;
  createdBy: string;
  createdAt: string;
  orderedAt?: string;
  status: "draft" | "ordered" | "partially_received" | "received" | "cancelled";
  lines: (z.infer<typeof draft>["lines"][number] & {
    quantityReceived: z.infer<typeof QuantitySchema>;
  })[];
};
