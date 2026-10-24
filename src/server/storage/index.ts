import type { Repositories } from "@/contracts";
import {
  MemoryBlobStore,
  MemoryDatasetRepository,
  MemoryJobRepository,
  MemorySelectionRepository,
  MemorySourceRepository,
} from "./memory";

let cached: Repositories | null = null;

/**
 * Repository factory. Initial implementation: process memory only.
 * Infrastructure replaces this with PostgreSQL + private blob storage when configured.
 */
export function getRepositories(): Repositories {
  if (cached) return cached;
  cached = {
    mode: "memory",
    durable: false,
    blobMode: "memory",
    sources: new MemorySourceRepository(),
    selections: new MemorySelectionRepository(),
    datasets: new MemoryDatasetRepository(),
    jobs: new MemoryJobRepository(),
    blobs: new MemoryBlobStore(),
    shares: null,
    ready: async () => true,
  };
  return cached;
}

/** Server-generated private key; never derived from the uploaded filename. */
export function newBlobKey(ownerId: string, sourceId: string): string {
  const ownerSegment = ownerId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return `sources/${ownerSegment}/${sourceId}`;
}
