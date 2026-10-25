import { randomBytes } from "node:crypto";
import os from "node:os";
import { databaseUrl } from "@/server/config/env";
import { LIMITS } from "@/server/config/limits";
import { runAnalysisJob } from "@/server/orchestration/analysis";
import { runJob } from "@/server/orchestration/extraction";
import { getRepositories } from "@/server/storage";
import { closePools } from "@/server/storage/pool";
import { PostgresJobRepository } from "@/server/storage/postgres";
import { JobWorker, WORKER_DEFAULTS } from "./runner";

/**
 * Worker process: `tsx --env-file-if-exists=.env.local src/server/jobs/worker.ts`
 *   [--concurrency=1] [--max-attempts=3] [--lease-ms=30000] [--poll-ms=1000]
 *
 * Requires DATABASE_URL: in memory mode the web server and worker would hold separate,
 * invisible copies of every job, so the worker refuses to start. Run the web server with
 * UNSPIN_JOBS_MODE=worker so requests only enqueue.
 */

const SHUTDOWN_GRACE_MS = 25_000;

function intArg(name: string, fallback: number, min: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < min) {
    console.error(`[worker] --${name} must be an integer ≥ ${min}`);
    process.exit(2);
  }
  return n;
}

async function main() {
  if (!databaseUrl()) {
    console.error("[worker] DATABASE_URL is not set. Worker mode needs PostgreSQL; memory mode runs jobs inline in the web server.");
    process.exit(2);
  }
  const repos = getRepositories();
  const workerId = `${os.hostname()}:${process.pid}:${randomBytes(3).toString("hex")}`;
  const options = {
    concurrency: intArg("concurrency", WORKER_DEFAULTS.concurrency, 1),
    maxAttempts: intArg("max-attempts", WORKER_DEFAULTS.maxAttempts, 1),
    leaseMs: intArg("lease-ms", WORKER_DEFAULTS.leaseMs, 1_000),
    pollMs: intArg("poll-ms", WORKER_DEFAULTS.pollMs, 100),
  };

  for (let wait = 1_000; !(await repos.ready()); wait = Math.min(wait * 2, 30_000)) {
    console.warn(`[worker] storage not ready; retrying in ${wait}ms`);
    await new Promise((r) => setTimeout(r, wait));
  }

  if (repos.jobs instanceof PostgresJobRepository) {
    const recovered = await repos.jobs.failOrphanedInlineJobs(LIMITS.providerTimeoutMs + 5 * 60_000);
    if (recovered > 0) console.warn(`[worker] failed ${recovered} orphaned inline job(s) left running by a stopped server`);
  }

  const dispatch = async (jobId: string) => {
    const rec = await repos.jobs.getRecord(jobId);
    if (rec?.job.operationType === "analysis") return runAnalysisJob(jobId);
    return runJob(jobId, workerId);
  };
  const worker = new JobWorker({ workerId, jobs: repos.jobs, run: dispatch, heartbeatMs: Math.floor(options.leaseMs / 3), ...options });
  console.log(`[worker] ${workerId} started concurrency=${options.concurrency} maxAttempts=${options.maxAttempts} leaseMs=${options.leaseMs}`);
  worker.start();

  const shutdown = async (signal: string) => {
    if (worker.isStopping) return;
    console.log(`[worker] ${signal}: finishing in-flight jobs (up to ${SHUTDOWN_GRACE_MS}ms)`);
    const drained = await worker.stop(SHUTDOWN_GRACE_MS);
    if (!drained) console.warn("[worker] grace period ended; unfinished jobs will be reclaimed after their lease expires");
    await closePools();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void main().catch(async (e) => {
  console.error(`[worker] fatal ${e instanceof Error ? e.name : typeof e}`);
  await closePools();
  process.exit(1);
});
