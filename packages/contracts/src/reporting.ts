import { z } from "zod";
import { UuidSchema } from "./identifiers";
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const ReportQuerySchema = z
  .strictObject({
    period: z.enum(["today", "7d", "30d", "custom"]).default("today"),
    from: DateSchema.optional(),
    to: DateSchema.optional(),
    locationId: UuidSchema.optional(),
    productId: UuidSchema.optional(),
    supplierId: UuidSchema.optional(),
    customerId: UuidSchema.optional(),
    paymentMethod: z.enum(["cash", "card"]).optional(),
  })
  .refine((v) =>
    v.period === "custom"
      ? v.from !== undefined && v.to !== undefined
      : v.from === undefined && v.to === undefined,
  );
export type ReportQuery = z.infer<typeof ReportQuerySchema>;
