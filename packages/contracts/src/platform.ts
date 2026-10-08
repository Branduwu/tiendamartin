import { z } from "zod";
import { UuidSchema } from "./identifiers";
export const CreateCompanySchema = z.strictObject({
  id: UuidSchema,
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((v) => !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(v)),
  ownerUserId: UuidSchema,
});
export const CompanyStatusSchema = z.strictObject({
  commandId: UuidSchema,
  status: z.enum(["active", "suspended"]),
});
export const PlatformPageSchema = z.strictObject({
  page: z
    .string()
    .regex(/^[1-9][0-9]{0,4}$/)
    .default("1"),
});
export const PlatformUsersQuerySchema = z.strictObject({
  page: z
    .string()
    .regex(/^[1-9][0-9]{0,4}$/)
    .default("1"),
  search: z.string().trim().max(254).default(""),
});
