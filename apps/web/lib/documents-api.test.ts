import { beforeEach, expect, it, vi } from "vitest";
import {
  PermissionDeniedError,
  PurchasingNotFoundError,
} from "@smartretail/application";
const f = vi.hoisted(() => ({
  user: vi.fn(),
  repo: { assertDocumentPurchase: vi.fn(), assertDocumentCapture: vi.fn() },
  validate: vi.fn(),
  storage: { upload: vi.fn(), download: vi.fn() },
}));
vi.mock("server-only", () => ({}));
vi.mock("./auth", () => ({ verifiedUserId: f.user }));
vi.mock("./database", () => ({ purchasingForUser: () => f.repo }));
vi.mock("./document-validation", () => ({ validateDocumentBytes: f.validate }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ storage: { from: () => f.storage } }),
}));
import { handleDocument } from "./documents-api";
const tenant = "550e8400-e29b-41d4-a716-446655440001",
  id = "550e8400-e29b-41d4-a716-446655440010";
function request(
  method = "POST",
  body: BodyInit = "fixture",
  headers: Record<string, string> = {},
) {
  return new Request("https://app.example/api/v1/purchases/document", {
    method,
    headers: {
      origin: "https://app.example",
      "x-tenant-id": tenant,
      "content-type": "image/png",
      ...headers,
    },
    ...(method === "GET" ? {} : { body }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("SUPABASE_STORAGE_SECRET_KEY", "fixture-only");
  f.user.mockResolvedValue(id);
  f.repo.assertDocumentCapture.mockResolvedValue(undefined);
  f.repo.assertDocumentPurchase.mockResolvedValue({ id });
  f.validate.mockResolvedValue({ pages: 1, mime: "image/png" });
  f.storage.upload.mockResolvedValue({ error: null });
  f.storage.download.mockResolvedValue({
    data: new Blob(["fixture"], { type: "image/png" }),
    error: null,
  });
});
it("requires authentication before reading documents", async () => {
  f.user.mockResolvedValue(null);
  expect((await handleDocument(request())).status).toBe(401);
  expect(f.validate).not.toHaveBeenCalled();
});
it("denies cashier/inactive/foreign membership before decoding", async () => {
  f.repo.assertDocumentCapture.mockRejectedValue(new PermissionDeniedError());
  expect((await handleDocument(request())).status).toBe(403);
  expect(f.validate).not.toHaveBeenCalled();
  expect(f.storage.upload).not.toHaveBeenCalled();
});
it("requires same origin and UUID tenant", async () => {
  expect(
    (
      await handleDocument(
        request("POST", "fixture", { origin: "https://foreign.example" }),
      )
    ).status,
  ).toBe(403);
  expect(
    (await handleDocument(request("POST", "fixture", { "x-tenant-id": "../" })))
      .status,
  ).toBe(400);
});
it("bounds streamed body even without Content-Length", async () => {
  expect(
    (await handleDocument(request("POST", new Uint8Array(4194305)))).status,
  ).toBe(400);
  expect(f.validate).not.toHaveBeenCalled();
});
it("validates before extraction without saving a temporary object", async () => {
  const response = await handleDocument(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ pages: 1, mime: "image/png" });
  expect(f.storage.upload).not.toHaveBeenCalled();
});
it("sanitizes file decode errors without reflecting names or text", async () => {
  f.validate.mockRejectedValue(new TypeError("secret file text"));
  const r = await handleDocument(request());
  expect(r.status).toBe(400);
  expect(await r.text()).not.toContain("secret");
});
it("binds an immutable original to an existing authorized purchase", async () => {
  expect((await handleDocument(request("PUT"), id)).status).toBe(200);
  expect(f.repo.assertDocumentPurchase).toHaveBeenCalledWith(id, true);
  expect(f.storage.upload).toHaveBeenCalledWith(
    `${tenant}/${id}/original`,
    expect.any(Buffer),
    { contentType: "image/png", upsert: false },
  );
});
it("does not create an object for missing or foreign purchase", async () => {
  f.repo.assertDocumentPurchase.mockRejectedValue(
    new PurchasingNotFoundError(),
  );
  expect((await handleDocument(request("PUT"), id)).status).toBe(404);
  expect(f.storage.upload).not.toHaveBeenCalled();
});
it("identical attachment retry succeeds and changed content conflicts", async () => {
  f.storage.upload.mockResolvedValue({ error: new Error("already exists") });
  expect((await handleDocument(request("PUT"), id)).status).toBe(200);
  expect((await handleDocument(request("PUT", "different"), id)).status).toBe(
    409,
  );
});
it("serves attachments privately without public or permanent URLs", async () => {
  const audit = vi.spyOn(console, "info").mockImplementation(() => {});
  const r = await handleDocument(request("GET"), id);
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(r.headers.get("content-disposition")).toContain("attachment;");
  expect(r.headers.get("content-security-policy")).toBe("default-src 'none'");
  const entry = JSON.parse(audit.mock.calls.at(-1)?.[0] as string);
  expect(entry).toMatchObject({
    operation: "purchases.document.download",
    actor: id,
    tenantId: tenant,
    purchaseId: id,
  });
  expect(entry.correlationId).toEqual(expect.any(String));
  expect(entry.at).toEqual(expect.any(String));
  expect(entry).not.toHaveProperty("document");
  audit.mockRestore();
});
it("read denial never accesses privileged storage", async () => {
  f.repo.assertDocumentPurchase.mockRejectedValue(new PermissionDeniedError());
  expect((await handleDocument(request("GET"), id)).status).toBe(403);
  expect(f.storage.download).not.toHaveBeenCalled();
});
it("rejects path traversal and unsupported verbs", async () => {
  expect((await handleDocument(request("PUT"), "../original")).status).toBe(
    400,
  );
  expect((await handleDocument(request("DELETE"), id)).status).toBe(405);
});
