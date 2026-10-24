import { AppError, type BlobStore, type Owner, type Repositories } from "@/contracts";
import { databaseUrl, s3Env, storageMode, storageRoot } from "@/server/config/env";
import { FilesystemBlobStore } from "./blob-fs";
import { S3BlobStore } from "./blob-s3";
import {
  claimGuestWorkspaceMemory,
  MemoryBlobStore,
  MemoryDatasetRepository,
  MemoryJobRepository,
  MemorySelectionRepository,
  MemorySourceRepository,
  memoryState,
} from "./memory";
import { getPool, probe } from "./pool";
import { claimGuestWorkspacePg, createPostgresRepositories } from "./postgres";
import type { ClaimResult } from "./shared";

export { newBlobKey } from "./blob-keys";
export type { ClaimResult } from "./shared";

interface Backend {
  repos: Repositories;
  claim(guest: Owner, account: Owner): Promise<ClaimResult>;
}

let cached: Backend | null = null;

/** Blob store used when S3 mode is selected but not fully configured: every call fails honestly. */
class UnconfiguredBlobStore implements BlobStore {
  private fail(): never {
    throw new AppError("not_configured", "Private object storage is selected but not configured on this server.");
  }
  async put(): Promise<void> {
    this.fail();
  }
  async get(): Promise<Uint8Array | null> {
    this.fail();
  }
  async delete(): Promise<void> {
    this.fail();
  }
}

function blobBackend(): { mode: Repositories["blobMode"]; store: BlobStore; ready: () => Promise<boolean> } {
  const mode = storageMode();
  if (mode === "filesystem") {
    const store = new FilesystemBlobStore(storageRoot());
    return { mode, store, ready: () => store.ready() };
  }
  if (mode === "s3") {
    const cfg = s3Env();
    if (!cfg) return { mode, store: new UnconfiguredBlobStore(), ready: async () => false };
    const store = new S3BlobStore(cfg);
    return { mode, store, ready: () => store.ready() };
  }
  return { mode: "memory", store: new MemoryBlobStore(), ready: async () => true };
}

function build(): Backend {
  const blobs = blobBackend();
  const url = databaseUrl();
  if (url) {
    const pool = getPool(url);
    const pg = createPostgresRepositories(pool);
    return {
      repos: {
        mode: "postgres",
        // Durable only when the source files are durable too.
        durable: blobs.mode !== "memory",
        blobMode: blobs.mode,
        ...pg,
        blobs: blobs.store,
        ready: async () => {
          const [db, blob] = await Promise.all([probe(pool), blobs.ready()]);
          return db && blob;
        },
      },
      claim: (guest, account) => claimGuestWorkspacePg(pool, guest, account),
    };
  }
  const state = memoryState();
  return {
    repos: {
      mode: "memory",
      durable: false,
      blobMode: blobs.mode,
      sources: new MemorySourceRepository(state),
      selections: new MemorySelectionRepository(state),
      datasets: new MemoryDatasetRepository(state),
      jobs: new MemoryJobRepository(state),
      blobs: blobs.store,
      // A share link that silently dies on restart would mislead its recipient.
      shares: null,
      ready: blobs.ready,
    },
    claim: async (guest, account) => claimGuestWorkspaceMemory(state, guest, account),
  };
}

/**
 * Repository factory. PostgreSQL + private blob storage (filesystem by default, S3 when
 * selected) when DATABASE_URL is set; process memory otherwise. Flags are honest:
 * `durable` is true only for PostgreSQL with non-memory blobs.
 */
export function getRepositories(): Repositories {
  cached ??= build();
  return cached.repos;
}

/** Explicit guest → account workspace claim in one transaction. Identity code calls this, never routes directly. */
export async function claimWorkspace(guest: Owner, account: Owner): Promise<ClaimResult> {
  cached ??= build();
  return cached.claim(guest, account);
}

/** Test hook: drop the cached backend so the next call re-reads configuration. */
export function resetRepositoriesForTests() {
  cached = null;
}
