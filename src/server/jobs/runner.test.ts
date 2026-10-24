import { randomBytes } from "node:crypto";
import path from "node:path";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JobRepository, Owner } from "@/contracts";
import { MemoryJobRepository, MemorySelectionRepository, MemorySourceRepository, MemoryState } from "@/server/storage/memory";
import { migrate } from "@/server/storage/migrate";
import { createPostgresRepositories } from "@/server/storage/postgres";
import * as fx from "@/server/storage/test-fixtures";
import { JobWorker } from "./runner";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quiet = () => undefined;

interface Ctx {
  jobs: JobRepository;
  enqueue(overrides?: Parameters<typeof fx.job>[1]): Promise<string>;
  cleanup(): Promise<void>;
}

async function memoryCtx(): Promise<Ctx> {
  const s = new MemoryState();
  return build(new MemorySourceRepository(s), new MemorySelectionRepository(s), new MemoryJobRepository(s), async () => undefined);
}

const url = process.env.UNSPIN_TEST_DATABASE_URL?.trim();

async function postgresCtx(): Promise<Ctx> {
  const schema = `t_${randomBytes(6).toString("hex")}`;
  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: url, max: 8, options: `-c search_path=${schema}` });
  await migrate(pool, path.resolve("db/schema"));
  const pg = createPostgresRepositories(pool);
  return build(pg.sources, pg.selections, pg.jobs, async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
}

async function build(
  sources: MemorySourceRepository | ReturnType<typeof createPostgresRepositories>["sources"],
  selections: MemorySelectionRepository | ReturnType<typeof createPostgresRepositories>["selections"],
  jobs: JobRepository,
  cleanup: () => Promise<void>,
): Promise<Ctx> {
  const owner: Owner = fx.guest();
  const src = fx.source();
  await sources.create(owner, { source: src, blobKey: `sources/x/${src.id}` });
  const sel = fx.selection(src.id);
  await selections.create(owner, sel);
  return {
    jobs,
    cleanup,
    async enqueue(overrides = {}) {
      const j = fx.job(sel.id, overrides);
      await jobs.createOrGet(owner, j, j.id);
      return j.id;
    },
  };
}

/** Mimics runJob's transitions: queued|running -> running (attempt+1) -> completed. */
function fakeRun(jobs: JobRepository, runs: string[], opts: { delayMs?: number; throwOnce?: Set<string> } = {}) {
  return async (jobId: string) => {
    const rec = await jobs.getRecord(jobId);
    const started = await jobs.transition(jobId, ["queued", "running"], { status: "running", attemptCount: rec!.job.attemptCount + 1 });
    if (!started) return;
    runs.push(jobId);
    if (opts.delayMs) await sleep(opts.delayMs);
    if (opts.throwOnce?.delete(jobId)) throw new Error("simulated crash");
    await jobs.transition(jobId, ["running"], { status: "completed", stage: "finished", finishedAt: new Date().toISOString() });
  };
}

for (const [name, make] of [
  ["memory", memoryCtx],
  ["postgres", postgresCtx],
] as const) {
  describe.skipIf(name === "postgres" && !url)(`JobWorker (${name})`, () => {
    let ctx: Ctx;
    beforeEach(async () => {
      ctx = await make();
    });
    afterEach(async () => {
      await ctx.cleanup();
    });

    it("claims and runs a queued job, then reports idle", async () => {
      const id = await ctx.enqueue();
      const runs: string[] = [];
      const w = new JobWorker({ workerId: "w1", jobs: ctx.jobs, run: fakeRun(ctx.jobs, runs), log: quiet });
      expect(await w.tick()).toBe("ran");
      expect(runs).toEqual([id]);
      expect((await ctx.jobs.getRecord(id))?.job).toMatchObject({ status: "completed", attemptCount: 1 });
      expect(await w.tick()).toBe("idle");
    });

    it("fails a job that reached the attempt limit instead of running it", async () => {
      const id = await ctx.enqueue({ status: "queued", attemptCount: 3 });
      const runs: string[] = [];
      const w = new JobWorker({ workerId: "w1", jobs: ctx.jobs, run: fakeRun(ctx.jobs, runs), maxAttempts: 3, log: quiet });
      expect(await w.tick()).toBe("exhausted");
      expect(runs).toEqual([]);
      const job = (await ctx.jobs.getRecord(id))!.job;
      expect(job.status).toBe("failed");
      expect(job.error).toMatchObject({ code: "internal", retryable: true });
      expect(job.error?.message).toMatch(/3 interrupted attempts/);
    });

    it("recovers from a crashed attempt via lease expiry, bounded by maxAttempts", async () => {
      const id = await ctx.enqueue();
      const runs: string[] = [];
      const run = fakeRun(ctx.jobs, runs, { throwOnce: new Set([id]) });
      const w1 = new JobWorker({ workerId: "w1", jobs: ctx.jobs, run, leaseMs: 80, heartbeatMs: 1_000, maxAttempts: 2, log: quiet });
      const w2 = new JobWorker({ workerId: "w2", jobs: ctx.jobs, run, leaseMs: 80, heartbeatMs: 1_000, maxAttempts: 2, log: quiet });
      expect(await w1.tick()).toBe("error");
      expect((await ctx.jobs.getRecord(id))?.job.status).toBe("running");
      expect(await w2.tick()).toBe("idle");
      await sleep(150);
      expect(await w2.tick()).toBe("ran");
      expect(runs).toEqual([id, id]);
      expect((await ctx.jobs.getRecord(id))?.job).toMatchObject({ status: "completed", attemptCount: 2 });
    });

    it("honors a cancellation requested before a reclaimed attempt", async () => {
      const id = await ctx.enqueue();
      await ctx.jobs.claimNext("dead-worker", 30);
      await ctx.jobs.transition(id, ["queued"], { status: "running", attemptCount: 1 });
      const owner = (await ctx.jobs.getRecord(id))!.owner;
      expect(await ctx.jobs.requestCancel(owner, id)).toMatchObject({ status: "running", cancellationRequested: true });
      await sleep(60);
      const runs: string[] = [];
      const w = new JobWorker({ workerId: "w1", jobs: ctx.jobs, run: fakeRun(ctx.jobs, runs), log: quiet });
      expect(await w.tick()).toBe("cancelled");
      expect(runs).toEqual([]);
      expect((await ctx.jobs.getRecord(id))?.job.status).toBe("cancelled");
    });

    it("keeps the lease alive with heartbeats during a long attempt", async () => {
      const id = await ctx.enqueue();
      const runs: string[] = [];
      const w1 = new JobWorker({ workerId: "w1", jobs: ctx.jobs, run: fakeRun(ctx.jobs, runs, { delayMs: 300 }), leaseMs: 100, heartbeatMs: 30, log: quiet });
      const w2 = new JobWorker({ workerId: "w2", jobs: ctx.jobs, run: fakeRun(ctx.jobs, runs), leaseMs: 100, log: quiet });
      const first = w1.tick();
      await sleep(200);
      expect(await w2.tick()).toBe("idle");
      expect(await first).toBe("ran");
      expect(runs).toEqual([id]);
    });

    it("two concurrent workers run every job exactly once", async () => {
      const ids = await Promise.all(Array.from({ length: 6 }, () => ctx.enqueue()));
      const runs: string[] = [];
      const opts = { jobs: ctx.jobs, run: fakeRun(ctx.jobs, runs, { delayMs: 10 }), pollMs: 10, maxPollMs: 20, log: quiet };
      const a = new JobWorker({ ...opts, workerId: "a", concurrency: 2 });
      const b = new JobWorker({ ...opts, workerId: "b", concurrency: 2 });
      a.start();
      b.start();
      for (let i = 0; i < 100 && runs.length < ids.length; i += 1) await sleep(20);
      expect(await a.stop(1_000)).toBe(true);
      expect(await b.stop(1_000)).toBe(true);
      expect([...runs].sort()).toEqual([...ids].sort());
      for (const id of ids) expect((await ctx.jobs.getRecord(id))?.job.status).toBe("completed");
    });

    it("stop() waits for the in-flight job and then stops claiming", async () => {
      const first = await ctx.enqueue();
      const runs: string[] = [];
      const w = new JobWorker({ workerId: "w1", jobs: ctx.jobs, run: fakeRun(ctx.jobs, runs, { delayMs: 100 }), pollMs: 10, log: quiet });
      w.start();
      await sleep(30);
      await ctx.enqueue();
      expect(await w.stop(2_000)).toBe(true);
      expect(runs).toEqual([first]);
      expect((await ctx.jobs.getRecord(first))?.job.status).toBe("completed");
    });
  });
}
