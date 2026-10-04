import { it, expect } from "vitest";
import { MemberSchema, UpdateMemberSchema } from "../src/index";
const id = "550e8400-e29b-41d4-a716-446655440001";
const input = {
  role: "cashier",
  status: "active",
  displayName: "Cajera Ana",
  locationIds: [id],
};
it("accepts explicit member assignments and read-only owner identity", () => {
  expect(UpdateMemberSchema.parse(input)).toEqual(input);
  expect(
    MemberSchema.parse({
      ...input,
      userId: id,
      role: "owner",
      allLocations: true,
    }).role,
  ).toBe("owner");
  expect(
    UpdateMemberSchema.safeParse({ ...input, locationIds: [] }).success,
  ).toBe(true);
  expect(
    UpdateMemberSchema.safeParse({ ...input, role: "admin", locationIds: [] })
      .success,
  ).toBe(true);
  expect(
    UpdateMemberSchema.safeParse({ ...input, role: "admin" }).success,
  ).toBe(false);
});
it("rejects owner grant, forged context, unsafe names and coercion", () => {
  for (const extra of [
    { role: "owner" },
    { role: "unknown" },
    { userId: id },
    { tenantId: id },
    { allLocations: true },
    { status: "disabled" },
    { displayName: " Ana " },
    { displayName: "" },
    { displayName: "a".repeat(81) },
    { displayName: "Ana\n" },
    { displayName: "\u200b" },
    { locationIds: [42] },
    { locationIds: "all" },
  ])
    expect(UpdateMemberSchema.safeParse({ ...input, ...extra }).success).toBe(
      false,
    );
  expect(UpdateMemberSchema.safeParse({}).success).toBe(false);
});
it("bounds location assignments and rejects duplicate UUIDs independent of casing", () => {
  const uuid = "550e8400-e29b-41d4-a716-446655440abc";
  expect(
    UpdateMemberSchema.safeParse({
      ...input,
      locationIds: [uuid, uuid.toUpperCase()],
    }).success,
  ).toBe(false);
  const locations = Array.from(
    { length: 100 },
    (_, i) => `550e8400-e29b-41d4-a716-${String(i).padStart(12, "0")}`,
  );
  expect(
    UpdateMemberSchema.safeParse({ ...input, locationIds: locations }).success,
  ).toBe(true);
  expect(
    UpdateMemberSchema.safeParse({ ...input, locationIds: [...locations, id] })
      .success,
  ).toBe(false);
});
