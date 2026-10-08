import { z } from "zod";
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/[\p{Cc}\p{Cs}\p{Cf}]/u.test(v));
export const BusinessProfileSchema = z.strictObject({
  businessName: text(120),
  tradeName: text(120).nullable(),
  phone: text(50).nullable(),
  email: z.email().max(254).nullable(),
  website: z
    .url({ protocol: /^https?$/ })
    .max(500)
    .refine((v) => {
      const u = new URL(v);
      return !u.username && !u.password;
    })
    .nullable(),
  ticketFooter: text(500).nullable(),
  logoUrl: z.null(),
  timezone: z.enum([
    "America/Mexico_City",
    "America/Tijuana",
    "America/Cancun",
    "America/Hermosillo",
  ]),
  locale: z.enum(["es-MX", "en-US"]),
  currency: z.literal("MXN"),
});
export const BranchSettingsSchema = z.strictObject({
  displayName: text(100).nullable(),
  address: text(300).nullable(),
  phone: text(50).nullable(),
  receiptHeader: text(300).nullable(),
  status: z.enum(["active", "inactive"]),
});
export type BusinessProfileDto = z.infer<typeof BusinessProfileSchema>;
export type BranchSettingsInputDto = z.infer<typeof BranchSettingsSchema>;
