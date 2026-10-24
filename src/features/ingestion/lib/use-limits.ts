"use client";

import type { Limits } from "@/contracts";
import { useWorkspace } from "@/features/workspace/context";

/** Server-configured limits from the health check; null until known (the server enforces them regardless). */
export function useLimits(): Limits | null {
  return useWorkspace().health?.limits ?? null;
}
