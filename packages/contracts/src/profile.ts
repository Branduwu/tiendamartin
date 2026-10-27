import { z } from "zod";

const personalName = z
  .string()
  .trim()
  .max(80)
  .refine((v) => !/[\p{Cc}\p{Cf}\p{Cs}<>]/u.test(v));
/** Presentation data only. No identity, email, membership or authorization fields. */
export const PersonalProfileSchema = z.strictObject({
  firstName: personalName.pipe(z.string().min(1)),
  lastName: personalName,
  phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^[+()\d .-]*$/),
});
export type PersonalProfileInput = z.infer<typeof PersonalProfileSchema>;
export type PersonalProfile = PersonalProfileInput & {
  email: string;
  displayName: string;
  photoEnabled: boolean;
};
export type ProfileOverview = PersonalProfile & {
  roles: { company: string; role: string; status: string }[];
  platformAdmin: boolean;
};
