import type { AnalysisConsent, AnalysisRecord, AnalysisRepository, Owner, SavedView, ViewRepository } from "@/contracts";
import { conflict } from "./shared";
import type { MemoryState } from "./memory";
import type { Db } from "./pool";

function owned<T extends { id: string }>(map: Map<string, { ownerId: string; value: T }>, owner: Owner, id: string): T | null {
  const e = map.get(id);
  return e && e.ownerId === owner.ownerId ? e.value : null;
}

export class MemoryViewRepository implements ViewRepository {
  constructor(private s: MemoryState) {}

  async list(owner: Owner, datasetId: string): Promise<SavedView[]> {
    return [...this.s.views.values()]
      .filter((e) => e.ownerId === owner.ownerId && e.value.datasetId === datasetId)
      .map((e) => structuredClone(e.value))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async get(owner: Owner, datasetId: string, viewId: string): Promise<SavedView | null> {
    const v = owned(this.s.views, owner, viewId);
    return v && v.datasetId === datasetId ? structuredClone(v) : null;
  }

  async create(owner: Owner, view: SavedView): Promise<void> {
    if (this.s.views.has(view.id)) throw conflict("View already exists.");
    this.s.views.set(view.id, { ownerId: owner.ownerId, value: structuredClone(view) });
  }

  async update(owner: Owner, view: SavedView): Promise<boolean> {
    const e = this.s.views.get(view.id);
    if (!e || e.ownerId !== owner.ownerId || e.value.datasetId !== view.datasetId) return false;
    e.value = structuredClone(view);
    return true;
  }

  async delete(owner: Owner, datasetId: string, viewId: string): Promise<boolean> {
    const e = this.s.views.get(viewId);
    if (!e || e.ownerId !== owner.ownerId || e.value.datasetId !== datasetId) return false;
    this.s.views.delete(viewId);
    return true;
  }
}

export class MemoryAnalysisRepository implements AnalysisRepository {
  constructor(private s: MemoryState) {}

  async list(owner: Owner, datasetId: string): Promise<AnalysisRecord[]> {
    return [...this.s.analysis.values()]
      .filter((e) => e.ownerId === owner.ownerId && e.value.datasetId === datasetId)
      .map((e) => structuredClone(e.value))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }

  async get(owner: Owner, datasetId: string, analysisId: string): Promise<AnalysisRecord | null> {
    const v = owned(this.s.analysis, owner, analysisId);
    return v && v.datasetId === datasetId ? structuredClone(v) : null;
  }

  async create(owner: Owner, record: AnalysisRecord): Promise<void> {
    this.s.analysis.set(record.id, { ownerId: owner.ownerId, value: structuredClone(record) });
  }

  async putConsent(owner: Owner, consent: AnalysisConsent): Promise<void> {
    this.s.consents.set(consent.id, { ownerId: owner.ownerId, value: structuredClone(consent) });
  }

  async getConsent(owner: Owner, consentId: string): Promise<AnalysisConsent | null> {
    return owned(this.s.consents, owner, consentId) ? structuredClone(owned(this.s.consents, owner, consentId)!) : null;
  }
}

export class PostgresViewRepository implements ViewRepository {
  constructor(private db: Db) {}

  async list(owner: Owner, datasetId: string): Promise<SavedView[]> {
    const { rows } = await this.db.query<{ data: SavedView }>(
      "SELECT data FROM saved_views WHERE owner_id = $1 AND dataset_id = $2 ORDER BY created_at, id",
      [owner.ownerId, datasetId],
    );
    return rows.map((r) => r.data);
  }

  async get(owner: Owner, datasetId: string, viewId: string): Promise<SavedView | null> {
    const { rows } = await this.db.query<{ data: SavedView }>(
      "SELECT data FROM saved_views WHERE id = $1 AND owner_id = $2 AND dataset_id = $3",
      [viewId, owner.ownerId, datasetId],
    );
    return rows[0]?.data ?? null;
  }

  async create(owner: Owner, view: SavedView): Promise<void> {
    await this.db.query(
      `INSERT INTO saved_views (id, owner_id, dataset_id, name, created_at, updated_at, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [view.id, owner.ownerId, view.datasetId, view.name, view.createdAt, view.updatedAt, JSON.stringify(view)],
    );
  }

  async update(owner: Owner, view: SavedView): Promise<boolean> {
    const r = await this.db.query(
      `UPDATE saved_views SET name = $1, updated_at = $2, data = $3::jsonb
       WHERE id = $4 AND owner_id = $5 AND dataset_id = $6`,
      [view.name, view.updatedAt, JSON.stringify(view), view.id, owner.ownerId, view.datasetId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async delete(owner: Owner, datasetId: string, viewId: string): Promise<boolean> {
    const r = await this.db.query("DELETE FROM saved_views WHERE id = $1 AND owner_id = $2 AND dataset_id = $3", [
      viewId,
      owner.ownerId,
      datasetId,
    ]);
    return (r.rowCount ?? 0) > 0;
  }
}

export class PostgresAnalysisRepository implements AnalysisRepository {
  constructor(private db: Db) {}

  async list(owner: Owner, datasetId: string): Promise<AnalysisRecord[]> {
    const { rows } = await this.db.query<{ data: AnalysisRecord }>(
      "SELECT data FROM analysis_records WHERE owner_id = $1 AND dataset_id = $2 ORDER BY created_at DESC, id DESC",
      [owner.ownerId, datasetId],
    );
    return rows.map((r) => r.data);
  }

  async get(owner: Owner, datasetId: string, analysisId: string): Promise<AnalysisRecord | null> {
    const { rows } = await this.db.query<{ data: AnalysisRecord }>(
      "SELECT data FROM analysis_records WHERE id = $1 AND owner_id = $2 AND dataset_id = $3",
      [analysisId, owner.ownerId, datasetId],
    );
    return rows[0]?.data ?? null;
  }

  async create(owner: Owner, record: AnalysisRecord): Promise<void> {
    const cacheKey = `${record.datasetId}:${record.versionId}:${record.kind}:${record.question ?? ""}:${JSON.stringify(record.scope)}`;
    await this.db.query(
      `INSERT INTO analysis_records (id, owner_id, dataset_id, version_id, kind, cache_key, created_at, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (owner_id, cache_key) DO UPDATE SET data = EXCLUDED.data, created_at = EXCLUDED.created_at, id = EXCLUDED.id`,
      [record.id, owner.ownerId, record.datasetId, record.versionId, record.kind, cacheKey, record.createdAt, JSON.stringify(record)],
    );
  }

  async putConsent(owner: Owner, consent: AnalysisConsent): Promise<void> {
    await this.db.query(
      `INSERT INTO analysis_consents (id, owner_id, dataset_id, version_id, granted_at, data)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [consent.id, owner.ownerId, consent.datasetId, consent.versionId, consent.grantedAt, JSON.stringify(consent)],
    );
  }

  async getConsent(owner: Owner, consentId: string): Promise<AnalysisConsent | null> {
    const { rows } = await this.db.query<{ data: AnalysisConsent }>(
      "SELECT data FROM analysis_consents WHERE id = $1 AND owner_id = $2",
      [consentId, owner.ownerId],
    );
    return rows[0]?.data ?? null;
  }
}
