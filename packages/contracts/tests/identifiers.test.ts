import { describe, expect, it } from "vitest";
import { UuidSchema } from "../src/index";

describe("UuidSchema", () => {
  it.each([
    "550e8400-e29b-41d4-a716-446655440000",
    "550E8400-E29B-41D4-A716-446655440000",
    "01890f3e-7bca-7cc1-98c4-dc0c0c07398f",
  ])("accepts a valid UUID without transforming it", (value) => {
    expect(UuidSchema.parse(value)).toBe(value);
  });

  const invalidInputs: readonly unknown[] = [
    "not-a-uuid",
    "",
    "550e8400-e29b-41d4-a716",
    "550e8400-e29b-41d4-0716-446655440000",
    " 550e8400-e29b-41d4-a716-446655440000",
    100,
    100n,
    null,
    undefined,
    {},
    [],
  ];
  it.each(invalidInputs.map((value) => ({ value })))(
    "rejects invalid UUID input: $value",
    ({ value }) => {
      expect(UuidSchema.safeParse(value).success).toBe(false);
    },
  );
});
