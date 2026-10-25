import type { PreparedDemoReport } from "@/contracts";
import { writeChartSettings } from "@/features/visualization/lib/chart-settings";
export function initializePreparedChart(dataset: PreparedDemoReport['datasets'][number]) {
  try { if (localStorage.getItem(`unspin.chart.v1.${dataset.id}`)) return; } catch { return; }
  writeChartSettings(dataset.id, { ...dataset.chart, hidden: [], scale: 'linear', baseline: dataset.chart.kind === 'bar' ? 'include_zero' : 'fit_data', bounds: { min: '', max: '' } });
}
