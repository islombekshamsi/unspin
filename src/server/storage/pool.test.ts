import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { AppError } from "@/contracts";
import { guardPool, probe, toStorageError } from "./pool";

describe("toStorageError", () => {
  it.each([
    { code: "ECONNREFUSED" },
    { code: "ENOTFOUND" },
    { code: "08006" },
    { code: "57P01" },
    { code: "53300" },
    { code: "3D000" },
    { code: "28P01" },
    { message: "timeout exceeded when trying to connect" },
    { message: "Connection terminated unexpectedly" },
  ])("maps %o to a retryable persistence_unavailable", (raw) => {
    const e = toStorageError(Object.assign(new Error(raw.message ?? "x"), raw));
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe("persistence_unavailable");
    expect((e as AppError).retryable).toBe(true);
  });

  it("passes query errors and AppErrors through unchanged", () => {
    const unique = Object.assign(new Error("dup"), { code: "23505" });
    expect(toStorageError(unique)).toBe(unique);
    const app = new AppError("version_conflict", "x");
    expect(toStorageError(app)).toBe(app);
  });
});

describe("unreachable database", () => {
  it("fails with a 503 that does not reveal the connection string, and probe() returns false", async () => {
    const pool = new Pool({ connectionString: "postgres://someone:hunter2@127.0.0.1:1/nodb", connectionTimeoutMillis: 500 });
    try {
      const err = await guardPool(pool).query("SELECT 1").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(503);
      expect((err as AppError).message).not.toMatch(/hunter2|someone|127\.0\.0\.1/);
      expect(await probe(pool, 1_000)).toBe(false);
    } finally {
      await pool.end();
    }
  });
});
