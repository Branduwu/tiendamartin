import { beforeEach, expect, it, vi } from "vitest";
import { PermissionDeniedError } from "@smartretail/application";
import {
  ProductImageConflictError,
  ProductImageRateLimitError,
} from "@smartretail/database";
const f = vi.hoisted(() => ({
  user: vi.fn(),
  repo: {
    image: vi.fn(),
    assertWrite: vi.fn(),
    changeImage: vi.fn(),
    listImages: vi.fn(),
  },
  storage: { upload: vi.fn(), download: vi.fn(), remove: vi.fn() },
  decode: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./auth", () => ({ verifiedUserId: f.user }));
vi.mock("./database", () => ({ productImagesForUser: () => f.repo }));
vi.mock("./product-image-processing", () => ({
  normalizedProductImage: f.decode,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ storage: { from: () => f.storage } }),
}));
import {
  handleProductImage,
  handleProductImageList,
} from "./product-images-api";
const tenant = "550e8400-e29b-41d4-a716-446655440001",
  product = "550e8400-e29b-41d4-a716-446655440010";
function request(
  method = "PUT",
  body: BodyInit = Buffer.from("fixture"),
  extra: Record<string, string> = {},
) {
  return new Request(
    "https://app.example/api/v1/products/" + product + "/image",
    {
      method,
      headers: {
        origin: "https://app.example",
        "x-tenant-id": tenant,
        "x-product-image-version": "none",
        "content-type": "image/jpeg",
        ...extra,
      },
      ...(method === "GET" || method === "DELETE" ? {} : { body }),
    },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("SUPABASE_STORAGE_SECRET_KEY", "fixture-only");
  f.user.mockResolvedValue("550e8400-e29b-41d4-a716-446655440020");
  f.repo.image.mockResolvedValue({
    imageId: product,
    objectPath: tenant + "/" + product + "/" + product + ".jpg",
  });
  f.repo.assertWrite.mockResolvedValue(undefined);
  f.repo.changeImage.mockResolvedValue(null);
  f.decode.mockResolvedValue(Buffer.from("encoded"));
  f.storage.upload.mockResolvedValue({ error: null });
  f.storage.remove.mockResolvedValue({ error: null });
  f.storage.download.mockResolvedValue({
    data: new Blob(["jpeg"]),
    error: null,
  });
});
it("requires session", async () => {
  f.user.mockResolvedValue(null);
  expect((await handleProductImage(request(), product)).status).toBe(401);
  expect(f.storage.upload).not.toHaveBeenCalled();
});
it("list only returns authorized references without storage paths", async () => {
  f.repo.listImages.mockResolvedValue([
    { productId: product, imageId: product },
  ]);
  const r = await handleProductImageList(request("GET"));
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({
    images: [{ productId: product, imageId: product }],
  });
  expect(f.storage.download).not.toHaveBeenCalled();
});
it("list denies foreign membership and malformed query", async () => {
  f.repo.listImages.mockRejectedValue(new PermissionDeniedError());
  expect((await handleProductImageList(request("GET"))).status).toBe(403);
  expect(
    (
      await handleProductImageList(
        new Request("https://app.example/api/v1/product-images?userId=forged", {
          headers: { "x-tenant-id": tenant },
        }),
      )
    ).status,
  ).toBe(400);
});
it("denies write before reading/decoding caller image", async () => {
  f.repo.assertWrite.mockRejectedValue(new PermissionDeniedError());
  expect((await handleProductImage(request(), product)).status).toBe(403);
  expect(f.decode).not.toHaveBeenCalled();
  expect(f.storage.upload).not.toHaveBeenCalled();
});
it("rejects forged tenant/path and injected query", async () => {
  expect(
    (
      await handleProductImage(
        request("PUT", Buffer.from("x"), { "x-tenant-id": "../../other" }),
        product,
      )
    ).status,
  ).toBe(400);
  const r = new Request(
    "https://app.example/api/v1/products/" + product + "/image?path=other",
    { method: "GET" },
  );
  expect((await handleProductImage(r, product)).status).toBe(400);
  expect(f.storage.download).not.toHaveBeenCalled();
});
it("requires same origin on mutations", async () => {
  expect(
    (
      await handleProductImage(
        request("PUT", Buffer.from("x"), { origin: "https://foreign.example" }),
        product,
      )
    ).status,
  ).toBe(403);
  expect(f.storage.upload).not.toHaveBeenCalled();
});
it("requires a valid explicit image version before write or decode", async () => {
  for (const version of ["", "../other", "100"]) {
    expect(
      (
        await handleProductImage(
          request("PUT", Buffer.from("x"), {
            "x-product-image-version": version,
          }),
          product,
        )
      ).status,
    ).toBe(400);
  }
  const missing = request();
  missing.headers.delete("x-product-image-version");
  expect((await handleProductImage(missing, product)).status).toBe(400);
  expect(f.repo.assertWrite).not.toHaveBeenCalled();
  expect(f.decode).not.toHaveBeenCalled();
});
it("deletes using the explicit version and removes old object only after commit", async () => {
  const old = tenant + "/" + product + "/" + product + ".jpg";
  f.repo.changeImage.mockResolvedValue(old);
  const r = await handleProductImage(
    request("DELETE", undefined, {
      "x-product-image-version": product,
    }),
    product,
  );
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ imageId: null });
  expect(f.repo.changeImage).toHaveBeenCalledWith(
    product,
    product,
    null,
    expect.any(String),
  );
  expect(f.storage.remove).toHaveBeenCalledWith([old]);
  expect(f.storage.upload).not.toHaveBeenCalled();
  expect(f.decode).not.toHaveBeenCalled();
});
it("bounds real streamed bytes before decode", async () => {
  expect(
    (
      await handleProductImage(
        request("PUT", new Uint8Array(3 * 1024 * 1024 + 1)),
        product,
      )
    ).status,
  ).toBe(400);
  expect(f.decode).not.toHaveBeenCalled();
});
it("sanitizes invalid content", async () => {
  f.decode.mockRejectedValue(new TypeError("private parser detail"));
  const r = await handleProductImage(request(), product);
  expect(r.status).toBe(400);
  expect(await r.text()).not.toContain("private");
});
it("uploads immutable server-derived key then CAS metadata", async () => {
  expect((await handleProductImage(request(), product)).status).toBe(200);
  const path = f.storage.upload.mock.calls[0]?.[0] as string;
  expect(path).toMatch(
    new RegExp("^" + tenant + "/" + product + "/[a-f0-9-]+\\.jpg$"),
  );
  expect(f.storage.upload.mock.calls[0]?.[2]).toEqual({
    contentType: "image/jpeg",
    upsert: false,
  });
  expect(f.repo.changeImage).toHaveBeenCalled();
});
it("does not delete potentially committed data when COMMIT response is lost", async () => {
  f.repo.changeImage.mockRejectedValue(new Error("COMMIT response lost"));
  expect((await handleProductImage(request(), product)).status).toBe(503);
  expect(f.storage.upload).toHaveBeenCalled();
  expect(f.storage.remove).not.toHaveBeenCalled();
});
it("returns conflicts without overwriting current reference", async () => {
  f.repo.changeImage.mockRejectedValue(new ProductImageConflictError());
  expect((await handleProductImage(request(), product)).status).toBe(409);
  expect(f.storage.remove).not.toHaveBeenCalled();
});
it("applies database quota before decode/upload", async () => {
  f.repo.assertWrite.mockRejectedValue(new ProductImageRateLimitError());
  expect((await handleProductImage(request(), product)).status).toBe(429);
  expect(f.decode).not.toHaveBeenCalled();
});
it("returns authorized image with private headers and fixed filename", async () => {
  const r = new Request(
    "https://app.example/api/v1/products/" +
      product +
      "/image?tenantId=" +
      tenant,
  );
  const result = await handleProductImage(r, product);
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(result.headers.get("x-content-type-options")).toBe("nosniff");
  expect(result.headers.get("content-disposition")).toBe(
    'inline; filename="producto.jpg"',
  );
});
