"use client";
import { useEffect, useState } from "react";
import type { DatasetDetail, PreparedDemoReport, SelectionEvent } from "@/contracts";
import { Badge, Button, Select } from "@/components/ui";
import { api } from "@/lib/api/client";
import { initializePreparedChart } from "./lib/prepared-chart";

export function PreparedDemoPanel({ sourceId, detail, onOpenDataset, onEvidence }: {
  sourceId: string; detail: DatasetDetail; onOpenDataset: (id: string) => void;
  onEvidence: (id: string, event: SelectionEvent) => void;
}) {
  const [report, setReport] = useState<PreparedDemoReport | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!detail.dataset.description.startsWith('Prepared demo v')) return;
    let cancelled=false;
    api.getPreparedDemo(sourceId).then((next)=>{ if(!cancelled) {next?.datasets.forEach(initializePreparedChart);setReport(next);setFailed(false);} },()=>{if(!cancelled)setFailed(true)});
    return ()=>{cancelled=true};
  },[sourceId, detail.dataset.description]);
  if (!detail.dataset.description.startsWith('Prepared demo v')) return null;
  if (failed) return <p role="alert">The prepared report could not be loaded. Refresh to retry; the saved tables are unchanged.</p>;
  if (!report) return <p role="status" className="text-sm text-ink-muted">Opening prepared analysis…</p>;
  return <section className="rounded-[24px] border border-accent/30 bg-surface p-5 sm:p-6" aria-label="Prepared analysis">
    <Badge>Previously prepared · {report.mode.charAt(0).toUpperCase() + report.mode.slice(1)}</Badge>
    <h2 className="mt-3 text-2xl tracking-tight text-ink-strong">{report.title.replace(/\bdemo\b/gi, 'analysis')}</h2>
    <p className="mt-3 text-sm leading-6 text-ink-muted">{report.scope.replace(/in this demo/gi, 'here')}</p>
    <p className="mt-2 text-xs leading-5 text-ink-muted">Findings refer to the original prepared snapshot. Edits remain separate, versioned changes; evidence opens that original version so later edits cannot silently change the report’s meaning.</p>
    <label className="mt-5 block text-xs text-ink-muted" htmlFor="prepared-dataset">Prepared table ({report.datasets.length})</label>
    <Select id="prepared-dataset" className="mt-2" value={detail.dataset.id} onChange={(e)=>onOpenDataset(e.target.value)}>
      {report.datasets.map((d)=><option key={d.id} value={d.id}>{d.title}</option>)}
    </Select>
    <div className="mt-5 grid gap-3 lg:grid-cols-2">
      {report.insights.map((insight)=><article key={insight.title} className="rounded-2xl border border-rule p-4">
        <h3 className="font-medium text-ink">{insight.title}</h3>
        <p className="mt-2 text-sm leading-6 text-ink-muted">{insight.text.replace(/this demo/gi, 'this analysis')}</p>
        <Button size="sm" className="mt-3" onClick={()=>onEvidence(insight.datasetId,insight.evidence)}>Inspect source evidence</Button>
      </article>)}
    </div>
    <details className="mt-4 text-xs leading-5 text-ink-muted"><summary className="cursor-pointer">Preparation and limitations</summary>
      <ul className="mt-2 list-disc space-y-1 pl-4">{report.limitations.map((text)=><li key={text}>{text}</li>)}</ul>
    </details>
  </section>;
}
