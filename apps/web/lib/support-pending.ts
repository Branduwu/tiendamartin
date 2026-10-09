import { UuidSchema } from "@smartretail/contracts";
export function supportStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
const key = "smartretail.support.pending.v1";
export type PendingSupport = Readonly<{ tenant: string; id: string }>;
// Only an opaque command pointer is retained, never the entered message or credentials.
export function pendingSupport(
  storage: Pick<Storage, "getItem"> | null,
): PendingSupport | null {
  try {
    const value: unknown = JSON.parse(storage?.getItem(key) ?? "null");
    if (
      !value ||
      typeof value !== "object" ||
      !("tenant" in value) ||
      !("id" in value)
    )
      return null;
    const tenant = UuidSchema.safeParse(value.tenant),
      id = UuidSchema.safeParse(value.id);
    return tenant.success && id.success
      ? { tenant: tenant.data, id: id.data }
      : null;
  } catch {
    return null;
  }
}
export function rememberSupport(
  storage: Pick<Storage, "setItem"> | null,
  pointer: PendingSupport,
) {
  try {
    storage?.setItem(key, JSON.stringify(pointer));
  } catch {
    /* In-memory intent and navigation guard remain available. */
  }
}
export function forgetSupport(
  storage:
    (Pick<Storage, "removeItem"> & Partial<Pick<Storage, "getItem">>) | null,
  expected?: PendingSupport,
) {
  try {
    if (expected && storage?.getItem) {
      const current = pendingSupport({
        getItem: storage.getItem.bind(storage),
      });
      if (current?.tenant !== expected.tenant || current.id !== expected.id)
        return;
    }
    storage?.removeItem(key);
  } catch {
    /* Optional storage must not turn a confirmed operation into an error. */
  }
}
