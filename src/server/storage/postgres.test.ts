import { randomBytes } from "node:crypto";
import path from "node:path";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { migrate } from "./migrate";
import { claimGuestWorkspacePg, createPostgresRepositories } from "./postgres";
import { runRepositoryContract } from "./repository-contract";

/**
 * Runs the shared repository contract against real PostgreSQL. Opt-in: set
 * UNSPIN_TEST_DATABASE_URL to a disposable database (e.g. postgres:///unspin_infra_test).
 * Each test gets its own schema (search_path), created by the migration runner and dropped after.
 */
const url = process.env.UNSPIN_TEST_DATABASE_URL?.trim();
const schemaDir = path.resolve("db/schema");

async function freshSchema() {
  const schema = `t_${randomBytes(6).toString("hex")}`;
  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  const pool = new Pool({ connectionString: url, max: 8, options: `-c search_path=${schema}` });
  return {
    schema,
    pool,
    async drop() {
      await pool.end();
      const a = new Pool({ connectionString: url, max: 1 });
      await a.query(`DROP SCHEMA ${schema} CASCADE`);
      await a.end();
    },
  };
}

describe.skipIf(!url)("postgres (real database)", () => {
  it("migration runner is idempotent and records checksums", async () => {
    const db = await freshSchema();
    try {
      const first = await migrate(db.pool, schemaDir);
      expect(first.applied).toEqual(["001_init"]);
      const second = await migrate(db.pool, schemaDir);
      expect(second).toEqual({ applied: [], skipped: ["001_init"] });
      const { rows } = await db.pool.query("SELECT version, checksum FROM schema_migrations");
      expect(rows).toHaveLength(1);
      expect(rows[0].checksum).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await db.drop();
    }
  });

  it("concurrent migration runners serialize on the advisory lock", async () => {
    const db = await freshSchema();
    try {
      const results = await Promise.all([migrate(db.pool, schemaDir), migrate(db.pool, schemaDir)]);
      expect(results.flatMap((r) => r.applied)).toEqual(["001_init"]);
    } finally {
      await db.drop();
    }
  });
});

if (url) {
  runRepositoryContract("postgres", async () => {
    const db = await freshSchema();
    await migrate(db.pool, schemaDir);
    const pg = createPostgresRepositories(db.pool);
    return {
      repos: { ...pg, claim: (g, a) => claimGuestWorkspacePg(db.pool, g, a) },
      cleanup: () => db.drop(),
    };
  });
}
