import { describe, expect, it } from "vitest";
import { config } from "./proxy";

describe("private session refresh routes", () => {
  it("covers private pages and their mutation APIs", () => {
    expect(config.matcher).toEqual(
      expect.arrayContaining([
        "/pos/:path*",
        "/cash/:path*",
        "/sales/:path*",
        "/api/v1/cash/:path*",
        "/api/v1/sales/:path*",
        "/api/v1/suspended-sales/:path*",
      ]),
    );
  });
});
