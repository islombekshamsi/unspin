/** Stable formatting/width avoids Recharts' auto-width measurement/update feedback. */
export function axisNumber(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toPrecision(6))) : "";
}
export function numericAxisWidth(domain: readonly [number, number] | null): number {
  if (!domain || !domain.every(Number.isFinite)) return 80;
  const labels = [domain[0], domain[1], domain[0] / 2 + domain[1] / 2].map(axisNumber);
  return Math.min(128, Math.max(64, Math.max(...labels.map((label) => label.length)) * 7 + 28));
}
export function hasNumericPlotPoint(points: readonly { x: string | number; y: number | null }[]): boolean {
  return points.some((point) => point.y !== null && Number.isFinite(point.y) && (typeof point.x !== "number" || Number.isFinite(point.x)));
}
