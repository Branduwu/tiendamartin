import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { Pool } from "../src/index";

const require = createRequire(import.meta.url);

describe("PostgreSQL driver entry", () => {
  it("preserves the installed driver's Pool constructor", () => {
    expect(Pool).toBe((require("pg") as typeof import("pg")).Pool);
  });

  it("does not open connections when constructing or ending an unused pool", async () => {
    const pool = new Pool({ max: 1 });
    expect(pool.totalCount).toBe(0);
    expect(pool.idleCount).toBe(0);
    await pool.end();
    await expect(pool.connect()).rejects.toThrow(/end/);
  });
});
