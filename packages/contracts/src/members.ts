import { z } from "zod";
import { UuidSchema } from "./identifiers";

export const MemberRoleSchema = z.enum([
  "owner",
  "admin",
  "cashier",
  "inventory_clerk",
]);
export const MemberDisplayNameSchema = z
  .string()
  .min(1)
  .max(80)
  .refine(
    (value) =>
      value.trim() === value &&
      /[^\p{M}\p{Z}]/u.test(value) &&
      !/[\p{Cc}\p{Cs}\p{Cf}]/u.test(value),
  );
const LocationIdsSchema = z
  .array(UuidSchema)
  .max(100)
  .refine(
    (values) =>
      new Set(values.map((id) => id.toLowerCase())).size === values.length,
  );
export const MemberSchema = z.strictObject({
  userId: UuidSchema,
  displayName: MemberDisplayNameSchema,
  role: MemberRoleSchema,
  status: z.enum(["active", "inactive"]),
  locationIds: LocationIdsSchema,
  allLocations: z.boolean(),
});
// Owner protection and assignment authorization are also enforced in PostgreSQL.
export const UpdateMemberSchema = z
  .strictObject({
    role: z.enum(["admin", "cashier", "inventory_clerk"]),
    status: z.enum(["active", "inactive"]),
    displayName: MemberDisplayNameSchema,
    locationIds: LocationIdsSchema,
  })
  .refine((value) => value.role !== "admin" || value.locationIds.length === 0, {
    path: ["locationIds"],
    message:
      "Administrators have access to all locations; explicit assignments must be empty",
  });
export type MemberDto = z.infer<typeof MemberSchema>;
export type UpdateMemberDto = z.infer<typeof UpdateMemberSchema>;
