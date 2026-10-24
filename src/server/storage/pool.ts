import { Pool, type PoolClient, type PoolConfig } from "pg";
import { AppError, isAppError } from "@/contracts";

/**
 * One pg Pool per connection string per process. Cached on globalThis so dev-server
 * HMR re-evaluating this module does not leak a new pool on every edit.
 * The connection string is never logged.
 */

const DEFAULTS: PoolConfig = {
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 30_000,
  application_name: "unspin",
};

type PoolCache = Map<string, Pool>;

function cache(): PoolCache {
  const g = globalThis as unknown as { __unspinPgPools?: PoolCache };
  g.__unspinPgPools ??= new Map();
  return g.__unspinPgPools;
}

export function getPool(connectionString: string, overrides: PoolConfig = {}): Pool {
  const key = `${connectionString}#${JSON.stringify(overrides)}`;
  const pools = cache();
  let pool = pools.get(key);
  if (!pool) {
    pool = new Pool({ ...DEFAULTS, ...overrides, connectionString });
    // An idle client error must not crash the process; the next query reconnects.
    pool.on("error", (e) => console.warn(`[db] idle client error ${e.name}`));
    pools.set(key, pool);
  }
  return pool;
}

export async function closePools(): Promise<void> {
  const pools = cache();
  const all = [...pools.values()];
  pools.clear();
  await Promise.all(all.map((p) => p.end().catch(() => undefined)));
}

/** The subset of Pool the repositories use; see guardPool. */
export type Db = Pick<Pool, "query" | "connect">;

const CONNECTION_ERRNOS = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "EHOSTUNREACH"]);
/** SQLSTATE classes/codes meaning "database unreachable or refusing service", not a query bug. */
const UNAVAILABLE_SQLSTATE = /^(08|57P0[1-3]|53300|3D000|28P01|28000)/;

/**
 * Converts connection-level failures into a retryable 503 that names no host, user, or
 * connection string. Query errors (constraint violations, bugs) pass through unchanged.
 */
export function toStorageError(e: unknown): unknown {
  if (isAppError(e)) return e;
  const err = e as { code?: string; message?: string };
  const unavailable =
    (typeof err?.code === "string" && (CONNECTION_ERRNOS.has(err.code) || UNAVAILABLE_SQLSTATE.test(err.code))) ||
    /Connection terminated|timeout exceeded when trying to connect/i.test(err?.message ?? "");
  return unavailable
    ? new AppError("persistence_unavailable", "Saved data is temporarily unavailable. Try again shortly.", { retryable: true, cause: e })
    : e;
}

/** Wraps a pool so every query/connect failure goes through toStorageError. */
export function guardPool(pool: Pool): Db {
  return {
    query: ((...args: Parameters<Pool["query"]>) =>
      (pool.query as (...a: unknown[]) => Promise<unknown>)(...args).catch((e) => {
        throw toStorageError(e);
      })) as Pool["query"],
    connect: (() =>
      pool.connect().catch((e) => {
        throw toStorageError(e);
      })) as Pool["connect"],
  };
}

/** Runs fn inside BEGIN/COMMIT; rolls back on any thrown error. */
export async function withTransaction<T>(db: Db, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw toStorageError(e);
  } finally {
    client.release();
  }
}

/** SELECT 1 with a short timeout; never throws. */
export async function probe(pool: Pool, timeoutMs = 2_000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const query = pool.query("SELECT 1 AS ok").then((r) => r.rows[0]?.ok === 1);
    return await Promise.race([query, timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
