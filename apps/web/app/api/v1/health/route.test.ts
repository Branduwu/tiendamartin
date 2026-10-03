import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/v1/health", () => {
  it("returns HTTP 200 and only the public health status as valid JSON", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(
      /^application\/json\b/,
    );

    const body: unknown = await response.json();
    expect(body).toStrictEqual({ status: "ok" });
  });
});
