import { AppError, type Job } from "@/contracts";

export const TERMINAL_JOB_STATUSES: Job["status"][] = ["completed", "failed", "cancelled"];

export function notFound(message: string): AppError {
  return new AppError("not_found", message);
}

export function conflict(message: string, details?: Record<string, unknown>): AppError {
  return new AppError("idempotency_conflict", message, details ? { details } : {});
}

/** Counts of top-level resources moved from a guest to an account. */
export interface ClaimResult {
  sources: number;
  datasets: number;
  jobs: number;
  shares: number;
}
