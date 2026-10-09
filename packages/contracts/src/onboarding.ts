import { z } from "zod";
import { UuidSchema } from "./identifiers";
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (v) =>
        v.trim() === v &&
        !/[\p{Cc}\p{Cs}\p{Cf}]/u.test(v) &&
        /[^\p{M}\p{Z}]/u.test(v),
    );
export const OnboardingSchema = z.strictObject({
  commandId: UuidSchema,
  businessName: text(120),
  tradeName: text(120).nullable(),
  phone: text(50).nullable(),
  email: z.email().max(254).nullable(),
  branchName: text(100),
});
export const CreateInvitationSchema = z
  .strictObject({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    role: z.enum(["admin", "cashier", "inventory_clerk"]),
    locationIds: z
      .array(UuidSchema)
      .max(100)
      .refine((v) => new Set(v.map((x) => x.toLowerCase())).size === v.length),
    expiresInDays: z.number().int().min(1).max(14),
  })
  .refine((v) => v.role !== "admin" || v.locationIds.length === 0);
export const AcceptInvitationSchema = z.strictObject({
  token: z.string().regex(/^[a-f0-9]{64}$/),
});
export type OnboardingInput = z.infer<typeof OnboardingSchema>;
export type CreateInvitationInput = z.infer<typeof CreateInvitationSchema>;
