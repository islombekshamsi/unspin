export type WorkspaceTab = "overview" | "data" | "source";

export const WORKSPACE_TABS: readonly WorkspaceTab[] = ["overview", "data", "source"];

export interface WorkspaceLayout {
  version: 2;
  tab: WorkspaceTab;
}

export const DEFAULT_LAYOUT: WorkspaceLayout = { version: 2, tab: "overview" };

export function layoutStorageKey(datasetId: string): string {
  return `unspin.workspace.${datasetId}`;
}

/**
 * Reads stored workspace layout. Only the current shape is honoured: the earlier
 * fixed-height layout stored `overviewOpen`/`focus`/`tab: "chart"`, and none of
 * those may recreate the old panels, so any other shape opens on Overview.
 */
export function normalizeLayout(raw: string | null): WorkspaceLayout {
  if (!raw) return DEFAULT_LAYOUT;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_LAYOUT;
  }
  if (!parsed || typeof parsed !== "object") return DEFAULT_LAYOUT;
  const { version, tab } = parsed as { version?: unknown; tab?: unknown };
  if (version !== 2) return DEFAULT_LAYOUT;
  return WORKSPACE_TABS.includes(tab as WorkspaceTab) ? { version: 2, tab: tab as WorkspaceTab } : DEFAULT_LAYOUT;
}

export function serializeLayout(layout: WorkspaceLayout): string {
  return JSON.stringify({ version: 2, tab: layout.tab });
}
