import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Pool } from "pg";
import { closePools, getPool } from "./pool";

/**
 * Forward-only migration runner.
 *
 * - Applies `NNN_name.sql` files from `dir` in lexical order; `*.down.sql` files are never applied.
 * - Each file runs in its own transaction and is recorded in schema_migrations with its sha256.
 * - Idempotent: already-applied files are skipped. An applied file whose content changed is an
 *   error (edit history by adding a new migration, never by rewriting an applied one).
 * - A session advisory lock serializes concurrent runners (e.g. two deploys starting at once).
 * - Operates on the connection's current search_path; nothing is schema-qualified.
 */

const MIGRATION_FILE = /^(\d{3,})_[a-z0-9_]+\.sql$/;
const LOCK_KEY = 0x756e7370; // "unsp"

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function listMigrationFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((f) => MIGRATION_FILE.test(f) && !f.endsWith(".down.sql")).sort();
}

export async function migrate(pool: Pool, dir: string): Promise<MigrationResult> {
  const files = await listMigrationFiles(dir);
  const client = await pool.connect();
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version     text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      "SELECT version, checksum FROM schema_migrations",
    );
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      const sql = await readFile(path.join(dir, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const prior = applied.get(version);
      if (prior !== undefined) {
        if (prior !== checksum) {
          throw new Error(`Migration ${version} changed after it was applied; add a new migration instead.`);
        }
        result.skipped.push(version);
        continue;
      }
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [version, checksum]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw new Error(`Migration ${version} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      result.applied.push(version);
    }
    return result;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

/** CLI: `tsx --env-file-if-exists=.env.local src/server/storage/migrate.ts [--dir db/migrations]` */
async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is not set; nothing to migrate.");
    process.exit(2);
  }
  const dirArg = process.argv.find((a) => a.startsWith("--dir="))?.slice("--dir=".length);
  const dir = path.resolve(dirArg ?? "db/migrations");
  try {
    const r = await migrate(getPool(url), dir);
    console.log(`[migrate] dir=${path.relative(process.cwd(), dir) || "."} applied=${r.applied.join(",") || "none"} skipped=${r.skipped.length}`);
  } catch (e) {
    console.error(`[migrate] ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    await closePools();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
