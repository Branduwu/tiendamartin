import { z } from "zod";
import { UuidSchema } from "./identifiers";
import { MoneySchema } from "./money";
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (v) =>
        v.trim().length > 0 &&
        !Array.from(v).some(
          (c) => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)),
        ),
    );
export const CustomerFieldsSchema = z.strictObject({
  name: text(200),
  phone: text(50).exactOptional(),
  email: z.email().max(254).exactOptional(),
  notes: text(2000).exactOptional(),
  status: z.enum(["active", "inactive"]),
});
export const CreateCustomerSchema = CustomerFieldsSchema.extend({
  id: UuidSchema,
});
export const UpdateCustomerSchema = z
  .strictObject({
    name: text(200).exactOptional(),
    status: z.enum(["active", "inactive"]).exactOptional(),
    phone: text(50).nullable().exactOptional(),
    email: z.email().max(254).nullable().exactOptional(),
    notes: text(2000).nullable().exactOptional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const CustomerSchema = CustomerFieldsSchema.extend({
  id: UuidSchema,
  tenantId: UuidSchema,
  createdAt: z.iso.datetime({ offset: true }),
  lastPurchaseAt: z.iso.datetime({ offset: true }).exactOptional(),
});
export const CustomerSearchSchema = z
  .string()
  .max(200)
  .transform((v) => v.trim());
export const CustomerSaleSchema = z.strictObject({
  id: UuidSchema,
  createdAt: z.iso.datetime({ offset: true }),
  total: MoneySchema,
  paymentMethods: z.array(z.enum(["cash", "card"])).max(2),
  returnedTotal: MoneySchema,
});
export type CustomerDto = z.infer<typeof CustomerSchema>;
export type CreateCustomerDto = z.infer<typeof CreateCustomerSchema>;
export type UpdateCustomerDto = z.infer<typeof UpdateCustomerSchema>;
export type CustomerSaleDto = z.infer<typeof CustomerSaleSchema>;
