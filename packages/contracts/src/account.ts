import { z } from "zod";

/** Matches the project's Auth policy; passwords are never trimmed or normalized. */
export const NewPasswordSchema = z
  .string()
  .min(8)
  .max(128)
  .refine((v) => !v.includes("\u0000") && !/\p{Cs}/u.test(v));
const passwords = {
  password: NewPasswordSchema,
  confirmation: NewPasswordSchema,
};
const matches = (value: { password: string; confirmation: string }) =>
  value.password === value.confirmation;
export const ResetPasswordSchema = z
  .strictObject({
    ...passwords,
    code: z.string().min(1).max(4096),
    flowId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{8,64}$/)
      .optional(),
  })
  .refine(matches, { message: "Las contraseñas no coinciden." });
export const ChangePasswordSchema = z
  .strictObject({
    ...passwords,
    currentPassword: z.string().min(1).max(1024),
    nonce: z
      .string()
      .regex(/^\d{6,10}$/)
      .optional(),
  })
  .refine(matches, { message: "Las contraseñas no coinciden." });
