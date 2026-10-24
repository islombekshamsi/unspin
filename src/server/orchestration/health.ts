import type { Health } from "@/contracts";
import { APP_VERSION, auth0Configured, elevenLabsConfigured, jobsMode } from "@/server/config/env";
import { publicLimits } from "@/server/config/limits";
import { extractionAvailability } from "@/server/extraction";
import { getRepositories } from "@/server/storage";

/** Capability booleans only: no secrets, connection strings, or source contents. */
export async function getHealth(): Promise<Health> {
  const repos = getRepositories();
  const ready = await repos.ready();
  const gemini = extractionAvailability();
  return {
    status: ready ? "ok" : "degraded",
    version: APP_VERSION,
    capabilities: {
      gemini: { configured: gemini.configured, model: gemini.configured ? gemini.model : null },
      persistence: { mode: repos.mode, durable: repos.durable, ready },
      blobStorage: { mode: repos.blobMode, ready },
      jobs: { mode: jobsMode() },
      accounts: { configured: auth0Configured() },
      sharing: { available: repos.shares !== null },
      narration: { configured: elevenLabsConfigured() },
    },
    limits: publicLimits(),
  };
}
