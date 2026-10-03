import { describe, expect, it } from "vitest";
import { databaseConfiguration } from "./database-config";
import { X509Certificate } from "node:crypto";
import { supabaseRootCertificate } from "./supabase-root-certificate";
// Deliberately fake endpoints/credentials: no connection is made by these tests.
const example =
  "postgresql://smartretail_api.example:FAKE@aws-0-example.pooler.supabase.com:6543/postgres";
describe("serverless database configuration", () => {
  it("uses one connection and verifies TLS even with sslmode=require", () => {
    const config = databaseConfiguration(example + "?sslmode=require", true);
    expect(config.max).toBe(1);
    expect(config.ssl).toEqual({
      rejectUnauthorized: true,
      ca: supabaseRootCertificate,
    });
    expect(config.connectionString).not.toContain("sslmode");
  });
  it.each(["postgres", "smartretail_owner", "service_role"])(
    "rejects runtime role %s",
    (role) => {
      expect(() =>
        databaseConfiguration(
          example.replace("smartretail_api.example", role),
          true,
        ),
      ).toThrow("Database configuration unavailable");
    },
  );
  it("rejects direct/session connections and local connections in production", () => {
    for (const value of [
      example.replace(":6543", ":5432"),
      example.replace(
        "aws-0-example.pooler.supabase.com",
        "db.example.supabase.co",
      ),
      "postgresql://smartretail_api:FAKE@localhost:5432/postgres",
    ])
      expect(() => databaseConfiguration(value, true)).toThrow();
  });
  it.each([
    "sslmode=disable",
    "sslmode=no-verify",
    "sslrootcert=bad",
    "options=role%3Dpostgres",
  ])("rejects TLS/session override %s", (query) => {
    expect(() => databaseConfiguration(example + "?" + query, true)).toThrow();
  });
  it("allows plaintext only for local development, remote development requires TLS", () => {
    expect(
      databaseConfiguration("postgresql://test:FAKE@127.0.0.1:5432/test", false)
        .ssl,
    ).toBe(false);
    expect(databaseConfiguration(example, false).ssl).toEqual({
      rejectUnauthorized: true,
      ca: supabaseRootCertificate,
    });
  });
  it("pins the official public Supabase CA without trusting it for other hosts", () => {
    const certificate = new X509Certificate(supabaseRootCertificate);
    expect(certificate.ca).toBe(true);
    expect(certificate.fingerprint256).toBe(
      "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
    );
    expect(
      databaseConfiguration(
        "postgresql://test:FAKE@other.example:5432/test",
        false,
      ).ssl,
    ).toEqual({ rejectUnauthorized: true });
  });
  it("does not expose invalid connection credentials in errors", () => {
    expect(() => databaseConfiguration("invalid:private", true)).toThrow(
      "Database configuration unavailable",
    );
    expect(() => databaseConfiguration(undefined, true)).toThrow(
      "Database configuration unavailable",
    );
  });
});
