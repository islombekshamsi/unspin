import {
  AppError,
  newId,
  type CreateSavedViewRequest,
  type DatasetOverview,
  type Owner,
  type SavedView,
  type UpdateSavedViewRequest,
  type ViewSpec,
} from "@/contracts";
import { buildOverview } from "@/server/analysis/profile";
import { applyView, defaultViewSpec } from "@/server/analysis/view-match";
import { getRepositories } from "@/server/storage";
import { requireDataset, requireVersion } from "./datasets";

const now = () => new Date().toISOString();

export async function listViews(owner: Owner, datasetId: string): Promise<SavedView[]> {
  await requireDataset(owner, datasetId);
  return getRepositories().views.list(owner, datasetId);
}

export async function createView(owner: Owner, datasetId: string, req: CreateSavedViewRequest): Promise<SavedView> {
  await requireDataset(owner, datasetId);
  const view: SavedView = {
    id: newId("view"),
    datasetId,
    name: req.name.trim(),
    spec: req.spec,
    createdAt: now(),
    updatedAt: now(),
  };
  await getRepositories().views.create(owner, view);
  return view;
}

export async function updateView(owner: Owner, datasetId: string, viewId: string, req: UpdateSavedViewRequest): Promise<SavedView> {
  const existing = await getRepositories().views.get(owner, datasetId, viewId);
  if (!existing) throw new AppError("not_found", "Saved view not found.");
  const next: SavedView = {
    ...existing,
    name: req.name?.trim() ?? existing.name,
    spec: req.spec ?? existing.spec,
    updatedAt: now(),
  };
  const ok = await getRepositories().views.update(owner, next);
  if (!ok) throw new AppError("not_found", "Saved view not found.");
  return next;
}

export async function deleteView(owner: Owner, datasetId: string, viewId: string): Promise<void> {
  const ok = await getRepositories().views.delete(owner, datasetId, viewId);
  if (!ok) throw new AppError("not_found", "Saved view not found.");
}

export async function getOverview(owner: Owner, datasetId: string, versionId: string, spec?: ViewSpec): Promise<DatasetOverview> {
  await requireDataset(owner, datasetId);
  const snapshot = await requireVersion(owner, datasetId, versionId);
  const view = spec ?? defaultViewSpec();
  const scoped = applyView(snapshot.rows, view);
  return buildOverview(snapshot, scoped);
}
