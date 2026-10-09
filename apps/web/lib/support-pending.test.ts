import { expect, it } from "vitest";
import {
  pendingSupport,
  rememberSupport,
  forgetSupport,
} from "./support-pending";
it("retains only tenant and command pointer for uncertain response recovery", () => {
  let value: string | null = null;
  const storage = {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    removeItem: () => {
      value = null;
    },
  };
  const pointer = {
    tenant: "550e8400-e29b-41d4-a716-446655440001",
    id: "550e8400-e29b-41d4-a716-446655440020",
  };
  rememberSupport(storage, pointer);
  expect(pendingSupport(storage)).toEqual(pointer);
  expect(Object.keys(JSON.parse(value!))).toEqual(["tenant", "id"]);
  const newer = { ...pointer, id: "550e8400-e29b-41d4-a716-446655440021" };
  rememberSupport(storage, newer);
  forgetSupport(storage, pointer);
  expect(pendingSupport(storage)).toEqual(newer);
  forgetSupport(storage);
  expect(pendingSupport(storage)).toBeNull();
});
it("rejects malformed or non-UUID persisted pointers without trusting identity", () => {
  for (const value of [
    "{bad",
    JSON.stringify({ tenant: "forged", id: "123" }),
    JSON.stringify({ id: "123" }),
  ])
    expect(pendingSupport({ getItem: () => value })).toBeNull();
  expect(
    pendingSupport({
      getItem() {
        throw Error("Storage disabled");
      },
    }),
  ).toBeNull();
});
