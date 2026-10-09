import { z } from "zod";
import { UuidSchema } from "./identifiers";

export const SupportCategorySchema = z.enum([
  "function",
  "error",
  "billing",
  "suggestion",
  "other",
]);
export const SupportStatusSchema = z.enum([
  "open",
  "in_progress",
  "resolved",
  "closed",
]);
export const SupportPagePathSchema = z.enum([
  "/help",
  "/help/support",
  "/dashboard",
  "/products",
  "/inventory",
  "/pos",
  "/cash",
  "/sales",
  "/customers",
  "/suppliers",
  "/purchases",
  "/receivables",
  "/payables",
  "/expenses",
  "/promotions",
  "/labels",
  "/settings/users",
  "/settings/taxes",
  "/settings/business",
  "/settings/account",
  "/onboarding",
]);
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (v) =>
        v.trim().length > 0 &&
        !/[\p{Cs}\p{Cf}]/u.test(v) &&
        !Array.from(v).some(
          (c) => /\p{Cc}/u.test(c) && ![9, 10, 13].includes(c.charCodeAt(0)),
        ),
    );
export const CreateSupportRequestSchema = z.strictObject({
  id: UuidSchema,
  category: SupportCategorySchema,
  subject: text(120).refine((v) => v.trim() === v && !/[\r\n\t]/.test(v)),
  description: text(4000),
  pagePath: SupportPagePathSchema,
});
export const UpdateSupportStatusSchema = z.strictObject({
  status: SupportStatusSchema,
});
export const SupportListQuerySchema = z.strictObject({
  page: z
    .string()
    .regex(/^[1-9][0-9]{0,4}$/)
    .default("1"),
  status: SupportStatusSchema.optional(),
});
export type CreateSupportRequestDto = z.infer<
  typeof CreateSupportRequestSchema
>;
export type SupportStatusDto = z.infer<typeof SupportStatusSchema>;
