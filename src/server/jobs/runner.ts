import type { JobRecord, JobRepository } from "@/contracts";

/**
 * Durable job worker loop, independent of any HTTP request.
 *
 * Each loop: claimNext (lease) → guard (cancellation, attempt limit) → run the job while
 * heartbeating the lease → repeat. Idle polls and storage errors back off exponentially.
 * Delivery is at-least-once: a worker that dies mid-job loses its lease, and another worker
 * reclaims the job after expiry; the job executor's completion is idempotent per selection.
 */

export interface WorkerOptions {
  workerId: string;
  jobs: JobRepository;
  /** Executes one attempt; must record its own terminal status (the coordinator's runJob). */
  run: (jobId: string, workerId: string) => Promise<void>;
  /** Lease length. runJob heartbeats every second with a 30 s lease, so keep this ≥ 30 s in production. */
  leaseMs?: number;
  heartbeatMs?: number;
  /** A job whose attemptCount has reached this is failed instead of run again. */
  maxAttempts?: number;
  pollMs?: number;
  maxPollMs?: number;
  concurrency?: number;
  log?: (line: string) => void;
}

export const WORKER_DEFAULTS = {
  leaseMs: 30_000,
  heartbeatMs: 10_000,
  maxAttempts: 3,
  pollMs: 1_000,
  maxPollMs: 15_000,
  concurrency: 1,
} as const;

export type TickResult = "ran" | "idle" | "cancelled" | "exhausted" | "error";

const errName = (e: unknown) => (e instanceof Error ? e.name : typeof e);

export class JobWorker {
  private readonly o: Required<Omit<WorkerOptions, "log">> & { log: (line: string) => void };
  private stopping = false;
  private loops: Promise<void>[] = [];
  private wake = new Set<() => void>();

  constructor(options: WorkerOptions) {
    this.o = { ...WORKER_DEFAULTS, log: (l) => console.log(l), ...options };
  }

  get isStopping() {
    return this.stopping;
  }

  /** Claims and processes at most one job. */
  async tick(): Promise<TickResult> {
    let rec: JobRecord | null;
    try {
      rec = await this.o.jobs.claimNext(this.o.workerId, this.o.leaseMs);
    } catch (e) {
      this.o.log(`[worker] claim failed ${errName(e)}`);
      return "error";
    }
    if (!rec) return "idle";
    const { job } = rec;
    const finishedAt = () => new Date().toISOString();

    if (job.cancellationRequested) {
      await this.o.jobs.transition(job.id, ["queued", "running"], { status: "cancelled", stage: "finished", finishedAt: finishedAt() });
      this.o.log(`[worker] ${job.id} cancelled before attempt ${job.attemptCount + 1}`);
      return "cancelled";
    }
    if (job.attemptCount >= this.o.maxAttempts) {
      await this.o.jobs.transition(job.id, ["queued", "running"], {
        status: "failed",
        stage: "finished",
        finishedAt: finishedAt(),
        error: {
          code: "internal",
          message: `Processing stopped after ${job.attemptCount} interrupted attempts. Nothing was saved; you can retry.`,
          retryable: true,
        },
      });
      this.o.log(`[worker] ${job.id} failed after ${job.attemptCount} attempts`);
      return "exhausted";
    }

    const beat = setInterval(() => {
      this.o.jobs.heartbeat(job.id, this.o.workerId, this.o.leaseMs).then(
        (held) => {
          if (!held) this.o.log(`[worker] ${job.id} lease no longer held`);
        },
        (e) => this.o.log(`[worker] ${job.id} heartbeat failed ${errName(e)}`),
      );
    }, this.o.heartbeatMs);
    const started = Date.now();
    try {
      await this.o.run(job.id, this.o.workerId);
      const after = await this.o.jobs.getRecord(job.id);
      this.o.log(`[worker] ${job.id} attempt ${job.attemptCount + 1} ${after?.job.status ?? "gone"} ${Date.now() - started}ms`);
      return "ran";
    } catch (e) {
      // The lease is left to expire so another attempt (bounded by maxAttempts) can recover.
      this.o.log(`[worker] ${job.id} attempt ${job.attemptCount + 1} threw ${errName(e)} ${Date.now() - started}ms`);
      return "error";
    } finally {
      clearInterval(beat);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        this.wake.delete(done);
        resolve();
      };
      const t = setTimeout(done, ms);
      this.wake.add(done);
    });
  }

  private async loop() {
    let delay = this.o.pollMs;
    while (!this.stopping) {
      const r = await this.tick();
      if (r === "idle" || r === "error") {
        await this.sleep(delay);
        delay = Math.min(delay * 2, this.o.maxPollMs);
      } else {
        delay = this.o.pollMs;
      }
    }
  }

  start(): void {
    if (this.loops.length > 0) return;
    this.stopping = false;
    for (let i = 0; i < this.o.concurrency; i += 1) this.loops.push(this.loop());
  }

  /** Stops claiming, wakes idle loops, and waits up to graceMs for in-flight jobs. Returns true when drained. */
  async stop(graceMs: number): Promise<boolean> {
    this.stopping = true;
    for (const w of [...this.wake]) w();
    let timer: NodeJS.Timeout | undefined;
    const drained = await Promise.race([
      Promise.all(this.loops).then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), graceMs);
      }),
    ]);
    clearTimeout(timer);
    if (drained) this.loops = [];
    return drained;
  }
}
