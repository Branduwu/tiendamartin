import { beforeEach, afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
const m = vi.hoisted(() => ({
  server: vi.fn(),
  user: vi.fn(),
  from: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./supabase/server", () => ({ serverAuth: m.server }));
vi.mock("./database", () => ({}));
import {
  handleProfilePhoto,
  normalizedProfilePhoto,
} from "./profile-photo-api";
const id = "550e8400-e29b-41d4-a716-446655440020";
let valid: Buffer;
beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubEnv("PROFILE_PHOTOS_ENABLED", "true");
  valid = await sharp({
    create: { width: 30, height: 20, channels: 3, background: "red" },
  })
    .withExif({ IFD0: { Artist: "Synthetic photo" } })
    .jpeg()
    .toBuffer();
  m.user.mockResolvedValue({ data: { user: { id } }, error: null });
  m.from.mockReturnValue({
    download: m.download,
    upload: m.upload,
    remove: m.remove,
  });
  m.server.mockResolvedValue({
    auth: { getUser: m.user },
    storage: { from: m.from },
  });
  m.upload.mockResolvedValue({ error: null });
  m.remove.mockResolvedValue({ error: null });
  m.download.mockResolvedValue({
    data: new Blob([new Uint8Array(valid)]),
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());
function request(
  method = "GET",
  body?: Uint8Array,
  mime = "image/jpeg",
  query = "",
  headers = {},
) {
  return new Request("https://example.test/api/v1/profile/photo" + query, {
    method,
    headers: {
      origin: "https://example.test",
      "content-type": mime,
      ...headers,
    },
    ...(body ? { body: new Uint8Array(body) } : {}),
  });
}
it("normalizes actual image bytes to a small JPEG and strips input metadata", async () => {
  expect((await sharp(valid).metadata()).exif).toBeDefined();
  const result = await normalizedProfilePhoto(valid, "image/jpeg");
  const meta = await sharp(result).metadata();
  expect(meta.format).toBe("jpeg");
  expect(meta.width).toBe(256);
  expect(meta.height).toBe(256);
  expect(meta.exif).toBeUndefined();
  expect(meta.icc).toBeUndefined();
});
it("writes only the verified user's private avatar with the user's own storage client", async () => {
  expect((await handleProfilePhoto(request("PUT", valid))).status).toBe(200);
  expect(m.from).toHaveBeenCalledWith("profile-photos");
  expect(m.upload).toHaveBeenCalledWith(
    id + "/avatar.jpg",
    expect.any(Buffer),
    { contentType: "image/jpeg", upsert: true, cacheControl: "0" },
  );
});
it("serves the own private photo without public URLs, cache or MIME sniffing", async () => {
  const r = await handleProfilePhoto(request());
  expect(r.status).toBe(200);
  expect(m.download).toHaveBeenCalledWith(id + "/avatar.jpg", {
    cacheNonce: expect.any(String),
  });
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  expect(r.headers.get("content-type")).toBe("image/jpeg");
});
it("rejects selecting another user's file by query or body", async () => {
  expect(
    (
      await handleProfilePhoto(
        request("GET", undefined, "image/png", "?userId=other"),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await handleProfilePhoto(
        request("PUT", Buffer.from('{"userId":"other"}'), "application/json"),
      )
    ).status,
  ).toBe(400);
  expect(m.upload).not.toHaveBeenCalled();
  expect(m.download).not.toHaveBeenCalled();
});
it("ignores forged identity headers and derives the path from verified Auth", async () => {
  await handleProfilePhoto(
    request("PUT", valid, "image/jpeg", "", {
      "x-user-id": "other",
      "x-tenant-id": "other",
    }),
  );
  expect(m.upload.mock.calls[0]?.[0]).toBe(id + "/avatar.jpg");
});
it("requires authentication and same origin before touching storage", async () => {
  m.user.mockResolvedValueOnce({ data: { user: null }, error: null });
  expect((await handleProfilePhoto(request())).status).toBe(401);
  expect(
    (
      await handleProfilePhoto(
        request("PUT", valid, "image/jpeg", "", {
          origin: "https://evil.invalid",
        }),
      )
    ).status,
  ).toBe(403);
  expect(m.from).not.toHaveBeenCalled();
});
it("remains disabled until its separately authorized storage dependency is enabled", async () => {
  vi.stubEnv("PROFILE_PHOTOS_ENABLED", "false");
  expect((await handleProfilePhoto(request("PUT", valid))).status).toBe(503);
  expect(m.from).not.toHaveBeenCalled();
});
it("rejects wrong MIME, signatures, SVG, truncated and oversized streamed files", async () => {
  for (const [body, mime] of [
    [valid, "image/png"],
    [Buffer.from('<svg onload="evil()"/>'), "image/svg+xml"],
    [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "image/png"],
    [Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "image/jpeg"],
    [Buffer.alloc(1572864 + 1), "image/jpeg"],
  ] as const)
    expect((await handleProfilePhoto(request("PUT", body, mime))).status).toBe(
      400,
    );
  expect(m.upload).not.toHaveBeenCalled();
});
it("rejects genuine PNG and WebP even with a forged JPEG MIME", async () => {
  for (const format of ["png", "webp"] as const) {
    const bytes = await sharp(valid).toFormat(format).toBuffer();
    expect(
      (await handleProfilePhoto(request("PUT", bytes, "image/jpeg"))).status,
    ).toBe(400);
    expect(
      (await handleProfilePhoto(request("PUT", bytes, `image/${format}`)))
        .status,
    ).toBe(400);
  }
  expect(m.upload).not.toHaveBeenCalled();
});
it("accepts exactly 1.5 MiB and rejects the next byte independently of declared length", async () => {
  const atLimit = Buffer.concat([valid, Buffer.alloc(1572864 - valid.length)]);
  expect((await handleProfilePhoto(request("PUT", atLimit))).status).toBe(200);
  m.upload.mockClear();
  expect(
    (
      await handleProfilePhoto(
        request(
          "PUT",
          Buffer.concat([atLimit, Buffer.from([0])]),
          "image/jpeg",
          "",
          { "content-length": "1" },
        ),
      )
    ).status,
  ).toBe(400);
  expect(m.upload).not.toHaveBeenCalled();
});
it("isolates synthetic identities for read, replace and remove without trusting tenant or user inputs", async () => {
  const other = "550e8400-e29b-41d4-a716-446655440021";
  for (const userId of [id, other]) {
    m.user.mockResolvedValue({ data: { user: { id: userId } }, error: null });
    await handleProfilePhoto(request("GET"));
    await handleProfilePhoto(
      request("PUT", valid, "image/jpeg", "", {
        "x-user-id": userId === id ? other : id,
      }),
    );
    await handleProfilePhoto(request("DELETE"));
    expect(m.download.mock.calls.at(-1)?.[0]).toBe(`${userId}/avatar.jpg`);
    expect(m.upload.mock.calls.at(-1)?.[0]).toBe(`${userId}/avatar.jpg`);
    expect(m.remove.mock.calls.at(-1)?.[0]).toEqual([`${userId}/avatar.jpg`]);
  }
});
it("removes only its own fixed avatar path, including a safe identical retry", async () => {
  expect((await handleProfilePhoto(request("DELETE"))).status).toBe(200);
  expect((await handleProfilePhoto(request("DELETE"))).status).toBe(200);
  expect(m.remove.mock.calls).toEqual([
    [[id + "/avatar.jpg"]],
    [[id + "/avatar.jpg"]],
  ]);
});
it("reports unknown upload outcome without retries or provider detail", async () => {
  m.upload.mockRejectedValue(Error("PRIVATE_STORAGE_TOKEN"));
  const r = await handleProfilePhoto(request("PUT", valid));
  expect(r.status).toBe(503);
  expect(await r.json()).toMatchObject({ code: "profile_photo_unconfirmed" });
  expect(m.upload).toHaveBeenCalledOnce();
});
it("distinguishes no photo from storage failure", async () => {
  m.download.mockResolvedValueOnce({
    error: { statusCode: "404" },
    data: null,
  });
  expect((await handleProfilePhoto(request())).status).toBe(404);
  m.download.mockResolvedValueOnce({
    error: { statusCode: "500", message: "PRIVATE" },
    data: null,
  });
  const r = await handleProfilePhoto(request());
  expect(r.status).toBe(503);
  expect(JSON.stringify(await r.json())).not.toContain("PRIVATE");
});
it("uses a fresh upstream cache nonce on each read of the fixed avatar path", async () => {
  await handleProfilePhoto(request());
  await handleProfilePhoto(request());
  expect(m.download.mock.calls[0]?.[0]).toBe(id + "/avatar.jpg");
  expect(m.download.mock.calls[1]?.[0]).toBe(id + "/avatar.jpg");
  expect(m.download.mock.calls[0]?.[1].cacheNonce).not.toBe(
    m.download.mock.calls[1]?.[1].cacheNonce,
  );
});
it("accepts a DELETE represented by an empty stream as in Next.js", async () => {
  const req = new Request("https://example.test/api/v1/profile/photo", {
    method: "DELETE",
    headers: { origin: "https://example.test" },
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.close();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  expect((await handleProfilePhoto(req)).status).toBe(200);
  expect(m.remove).toHaveBeenCalledWith([id + "/avatar.jpg"]);
});
it("rejects a nonempty DELETE body before attempting removal", async () => {
  const response = await handleProfilePhoto(
    request("DELETE", Buffer.from("unexpected")),
  );
  expect(response.status).toBe(400);
  expect(m.remove).not.toHaveBeenCalled();
});
