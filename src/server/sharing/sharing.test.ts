import { describe, expect, it } from "vitest";
import { AppError, type Owner, type Repositories } from "@/contracts";
import {
  MemoryBlobStore,
  MemoryDatasetRepository,
  MemoryJobRepository,
  MemorySelectionRepository,
  MemoryShareRepository,
  MemorySourceRepository,
  MemoryState,
} from "@/server/storage/memory";
import * as fx from "@/server/storage/test-fixtures";
import { createShare, getSharedSourceBytes, hashShareToken, listShares, resolveShare, revokeShare } from ".";

function memoryRepos(): Repositories {
  const s = new MemoryState();
  return {
    mode: "memory",
    durable: false,
    blobMode: "memory",
    sources: new MemorySourceRepository(s),
    selections: new MemorySelectionRepository(s),
    datasets: new MemoryDatasetRepository(s),
    jobs: new MemoryJobRepository(s),
    blobs: new MemoryBlobStore(s),
    shares: new MemoryShareRepository(s),
    ready: async () => true,
  };
}

async function seeded(repos: Repositories, owner: Owner) {
  const src = fx.source();
  const blobKey = `sources/${owner.ownerId}/${src.id}`;
  await repos.blobs.put(blobKey, new Uint8Array([7, 7]));
  await repos.sources.create(owner, { source: src, blobKey });
  const sel = fx.selection(src.id);
  await repos.selections.create(owner, sel);
  const d = fx.datasetFor(owner, sel);
  await repos.datasets.create(owner, { dataset: d.dataset, initialSnapshot: d.snapshot, provenance: d.provenance, historyEntry: d.history });
  return { src, ...d };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof AppError ? e.code : "other";
  }
}

describe("sharing service", () => {
  it("stores only the token hash and resolves a read-only view of one version", async () => {
    const repos = memoryRepos();
    const owner = fx.guest();
    const s = await seeded(repos, owner);
    const { share, token } = await createShare(owner, s.dataset.id, { versionId: s.snapshot.version.id }, { repos });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(share.includeSource).toBe(false);
    expect(Date.parse(share.expiresAt) - Date.parse(share.createdAt)).toBe(7 * 24 * 3_600_000);
    expect(JSON.stringify(await repos.shares!.listByDataset(owner, s.dataset.id))).not.toContain(token);
    expect(await repos.shares!.resolve(hashShareToken(token), new Date().toISOString())).not.toBeNull();
    expect(await repos.shares!.resolve(token, new Date().toISOString())).toBeNull();

    const view = await resolveShare(token, { repos });
    expect(view.snapshot).toEqual(s.snapshot);
    expect(view.source).toBeNull();
    expect(view).not.toHaveProperty("owner");
    expect(await code(getSharedSourceBytes(token, { repos }))).toBe("forbidden");
  });

  it("includes the source only when explicitly enabled", async () => {
    const repos = memoryRepos();
    const owner = fx.guest();
    const s = await seeded(repos, owner);
    const { token } = await createShare(owner, s.dataset.id, { versionId: s.snapshot.version.id, includeSource: true }, { repos });
    expect((await resolveShare(token, { repos })).source?.id).toBe(s.src.id);
    expect((await getSharedSourceBytes(token, { repos })).bytes).toEqual(new Uint8Array([7, 7]));
  });

  it("denies revoked, expired, malformed, and unknown tokens identically", async () => {
    const repos = memoryRepos();
    const owner = fx.guest();
    const s = await seeded(repos, owner);
    const t0 = new Date("2026-10-24T00:00:00.000Z");
    const { share, token } = await createShare(owner, s.dataset.id, { versionId: s.snapshot.version.id, expiresInHours: 1 }, { repos, now: () => t0 });
    const at = (ms: number) => ({ repos, now: () => new Date(t0.getTime() + ms) });
    expect(await code(resolveShare(token, at(59 * 60_000)))).toBe("ok");
    expect(await code(resolveShare(token, at(60 * 60_000)))).toBe("not_found");
    expect(await code(resolveShare("not-a-token", { repos }))).toBe("not_found");
    expect(await code(resolveShare("A".repeat(43), { repos }))).toBe("not_found");

    const live = await createShare(owner, s.dataset.id, { versionId: s.snapshot.version.id }, { repos });
    await revokeShare(owner, live.share.id, { repos });
    expect(await code(resolveShare(live.token, { repos }))).toBe("not_found");
    expect((await listShares(owner, s.dataset.id, { repos })).map((x) => x.id)).toEqual([share.id, live.share.id]);
  });

  it("enforces ownership on create, revoke, and list", async () => {
    const repos = memoryRepos();
    const owner = fx.guest();
    const other = fx.guest();
    const s = await seeded(repos, owner);
    expect(await code(createShare(other, s.dataset.id, { versionId: s.snapshot.version.id }, { repos }))).toBe("not_found");
    const { share, token } = await createShare(owner, s.dataset.id, { versionId: s.snapshot.version.id }, { repos });
    expect(await code(revokeShare(other, share.id, { repos }))).toBe("not_found");
    expect(await code(listShares(other, s.dataset.id, { repos }))).toBe("not_found");
    expect(await code(resolveShare(token, { repos }))).toBe("ok");
    expect(await code(createShare(owner, s.dataset.id, { versionId: s.snapshot.version.id, expiresInHours: 24 * 31 }, { repos }))).toBe("bad_request");
  });

  it("stops resolving once the source is deleted", async () => {
    const repos = memoryRepos();
    const owner = fx.guest();
    const s = await seeded(repos, owner);
    const { token } = await createShare(owner, s.dataset.id, { versionId: s.snapshot.version.id }, { repos });
    await repos.datasets.deleteBySource(owner, s.src.id);
    await repos.sources.delete(owner, s.src.id);
    expect(await code(resolveShare(token, { repos }))).toBe("not_found");
  });
});
