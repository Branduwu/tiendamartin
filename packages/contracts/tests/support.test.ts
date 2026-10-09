import { expect, it } from "vitest";
import {
  CreateSupportRequestSchema,
  SupportListQuerySchema,
  UpdateSupportStatusSchema,
} from "../src";
const value = {
  id: "550e8400-e29b-41d4-a716-446655440020",
  category: "error",
  subject: "No puedo abrir caja",
  description: "La sucursal está activa.\nIntenté abrir el turno.",
  pagePath: "/cash",
};
it("accepts bounded human text without interpreting HTML", () => {
  expect(
    CreateSupportRequestSchema.parse({
      ...value,
      subject: "<img src=x onerror=alert(1)>",
    }).subject,
  ).toContain("<img");
});
it("rejects identity, status and automatic metadata injection", () => {
  for (const extra of [
    { tenantId: value.id },
    { createdByUserId: value.id },
    { status: "closed" },
    { metadata: { token: "private" } },
    { __proto__: null, logs: "dump" },
  ])
    expect(
      CreateSupportRequestSchema.safeParse({ ...value, ...extra }).success,
    ).toBe(false);
});
it("bounds subject and description", () => {
  expect(
    CreateSupportRequestSchema.safeParse({ ...value, subject: "x".repeat(121) })
      .success,
  ).toBe(false);
  expect(
    CreateSupportRequestSchema.safeParse({
      ...value,
      description: "x".repeat(4001),
    }).success,
  ).toBe(false);
  expect(
    CreateSupportRequestSchema.safeParse({
      ...value,
      subject: "x".repeat(120),
      description: "x".repeat(4000),
    }).success,
  ).toBe(true);
});
it("rejects blank, control and malformed unicode text", () => {
  for (const description of ["  ", "\0", "a\u0001", "\ud800"])
    expect(
      CreateSupportRequestSchema.safeParse({ ...value, description }).success,
    ).toBe(false);
});
it("does not coerce types or accept unknown categories", () => {
  for (const patch of [
    { description: 123 },
    { subject: null },
    { category: "urgent" },
    { id: "123" },
  ])
    expect(
      CreateSupportRequestSchema.safeParse({ ...value, ...patch }).success,
    ).toBe(false);
});
it("allows only static context paths without private query or IDs", () => {
  for (const pagePath of [
    "https://example.com/cash",
    "/cash?token=private",
    "/customers/550e8400-e29b-41d4-a716-446655440020",
    "/cash#secret",
    "/%63ash",
  ])
    expect(
      CreateSupportRequestSchema.safeParse({ ...value, pagePath }).success,
    ).toBe(false);
});
it("bounds and validates pagination", () => {
  expect(SupportListQuerySchema.parse({})).toEqual({ page: "1" });
  for (const page of ["0", "01", "100000", 1, "-1"])
    expect(SupportListQuerySchema.safeParse({ page }).success).toBe(false);
});
it("accepts only explicit states and no role fields", () => {
  for (const status of ["open", "in_progress", "resolved", "closed"])
    expect(UpdateSupportStatusSchema.safeParse({ status }).success).toBe(true);
  expect(
    UpdateSupportStatusSchema.safeParse({
      status: "closed",
      role: "platform_admin",
    }).success,
  ).toBe(false);
});
