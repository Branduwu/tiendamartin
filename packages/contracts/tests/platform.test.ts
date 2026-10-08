import { expect, it } from "vitest";
import {
  CreateCompanySchema,
  CompanyStatusSchema,
  PlatformUsersQuerySchema,
} from "../src/index";
const command = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  displayName: "Empresa",
  ownerUserId: "550e8400-e29b-41d4-a716-446655440020",
};
it("accepts a bounded company and only an existing-user identifier contract", () => {
  expect(CreateCompanySchema.parse(command)).toEqual(command);
  for (const change of [
    { displayName: " " },
    { displayName: "a".repeat(121) },
    { displayName: "a\u202eb" },
    { ownerUserId: "bad" },
    { role: "platform_admin" },
    { status: "active" },
  ])
    expect(
      CreateCompanySchema.safeParse({ ...command, ...change }).success,
    ).toBe(false);
});
it("only allows explicit lifecycle states without arbitrary fields", () => {
  for (const status of ["active", "suspended"])
    expect(
      CompanyStatusSchema.safeParse({ status, commandId: command.id }).success,
    ).toBe(true);
  for (const value of [
    { status: "deleted" },
    { status: "active", tenantId: command.id },
    { status: true },
  ])
    expect(CompanyStatusSchema.safeParse(value).success).toBe(false);
});
it("bounds directory queries and rejects coerced or unknown paging", () => {
  expect(PlatformUsersQuerySchema.parse({})).toEqual({ page: "1", search: "" });
  for (const query of [
    { page: "0" },
    { page: "01" },
    { page: 1 },
    { page: "1e3" },
    { search: "a".repeat(255) },
    { role: "owner" },
  ])
    expect(PlatformUsersQuerySchema.safeParse(query).success).toBe(false);
});
