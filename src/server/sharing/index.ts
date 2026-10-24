import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  AppError,
  IdSchema,
  newId,
  type Dataset,
  type DatasetVersionSnapshot,
  type Owner,
  type Provenance,
  type Repositories,
  type Share,
  type Source,
} from "@/contracts";
import { getRepositories } from "@/server/storage";

/**
 * Read-only, expiring, revocable share links. The bearer token is shown once at creation;
 * only sha256(token) is stored. Every access re-checks revocation, expiry, and that the
 * dataset/version still exist. Source files are excluded unless includeSource was chosen.
 */

export const SHARE_DEFAULT_HOURS = 24 * 7;
export const SHARE_MAX_HOURS = 24 * 30;

export const CreateShareRequestSchema = z.object({
  versionId: IdSchema,
  expiresInHours: z.number().int().min(1).max(SHARE_MAX_HOURS).default(SHARE_DEFAULT_HOURS),
  includeSource: z.boolean().default(false),
});
export type CreateShareRequest = z.input<typeof CreateShareRequestSchema>;

export interface CreatedShare {
  share: Share;
  /** Bearer secret for the link. Returned once; never stored or logged. */
  token: string;
}

export interface SharedView {
  share: Share;
  dataset: Dataset;
  snapshot: DatasetVersionSnapshot;
  provenance: Provenance[];
  /** Source metadata only when the owner enabled source sharing. */
  source: Source | null;
}

interface Deps {
  repos?: Repositories;
  now?: () => Date;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sharesOf(repos: Repositories) {
  if (!repos.shares) throw new AppError("not_configured", "Read-only sharing is not available on this server.");
  return repos.shares;
}

const notFound = () => new AppError("not_found", "This share link is invalid, expired, or revoked.");

export async function createShare(owner: Owner, datasetId: string, input: CreateShareRequest, deps: Deps = {}): Promise<CreatedShare> {
  const repos = deps.repos ?? getRepositories();
  const shares = sharesOf(repos);
  const parsed = CreateShareRequestSchema.safeParse(input);
  if (!parsed.success) throw new AppError("bad_request", `Share links last between 1 and ${SHARE_MAX_HOURS} hours.`);
  const req = parsed.data;
  if (!(await repos.datasets.getVersion(owner, datasetId, req.versionId))) {
    throw new AppError("not_found", "Dataset version not found.");
  }
  const now = (deps.now ?? (() => new Date()))();
  const token = randomBytes(32).toString("base64url");
  const share: Share = {
    id: newId("shr"),
    datasetId,
    versionId: req.versionId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + req.expiresInHours * 3_600_000).toISOString(),
    revokedAt: null,
    includeSource: req.includeSource,
  };
  await shares.create(owner, share, hashShareToken(token));
  return { share, token };
}

export async function revokeShare(owner: Owner, shareId: string, deps: Deps = {}): Promise<void> {
  const repos = deps.repos ?? getRepositories();
  const at = (deps.now ?? (() => new Date()))().toISOString();
  if (!(await sharesOf(repos).revoke(owner, shareId, at))) throw new AppError("not_found", "Share not found.");
}

export async function listShares(owner: Owner, datasetId: string, deps: Deps = {}): Promise<Share[]> {
  const repos = deps.repos ?? getRepositories();
  if (!(await repos.datasets.get(owner, datasetId))) throw new AppError("not_found", "Dataset not found.");
  return sharesOf(repos).listByDataset(owner, datasetId);
}

async function resolveRecord(token: string, deps: Deps) {
  const repos = deps.repos ?? getRepositories();
  if (!TOKEN_PATTERN.test(token)) throw notFound();
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const hit = await sharesOf(repos).resolve(hashShareToken(token), now);
  if (!hit) throw notFound();
  return { repos, ...hit };
}

/** Resolves a share at access time and returns only what the link grants (one version, read-only). */
export async function resolveShare(token: string, deps: Deps = {}): Promise<SharedView> {
  const { repos, share, owner } = await resolveRecord(token, deps);
  const [dataset, snapshot, provenance] = await Promise.all([
    repos.datasets.get(owner, share.datasetId),
    repos.datasets.getVersion(owner, share.datasetId, share.versionId),
    repos.datasets.getProvenance(owner, share.datasetId),
  ]);
  if (!dataset || !snapshot) throw notFound();
  const referenced = new Set(snapshot.rows.flatMap((r) => Object.values(r.cells).flatMap((c) => c.provenanceIds)));
  const source = share.includeSource ? ((await repos.sources.get(owner, dataset.sourceId))?.source ?? null) : null;
  return { share, dataset, snapshot, provenance: provenance.filter((p) => referenced.has(p.id)), source };
}

/** Source bytes for a share that explicitly includes the source; forbidden otherwise. */
export async function getSharedSourceBytes(token: string, deps: Deps = {}): Promise<{ source: Source; bytes: Uint8Array }> {
  const { repos, share, owner } = await resolveRecord(token, deps);
  if (!share.includeSource) throw new AppError("forbidden", "This share link does not include the source file.");
  const dataset = await repos.datasets.get(owner, share.datasetId);
  const rec = dataset ? await repos.sources.get(owner, dataset.sourceId) : null;
  const bytes = rec ? await repos.blobs.get(rec.blobKey) : null;
  if (!rec || !bytes) throw notFound();
  return { source: rec.source, bytes };
}
