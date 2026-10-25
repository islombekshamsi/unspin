/** Display-only ranges; source values are never transformed. */
export function zoomDomain(domain: [number, number], factor: number, offset = 0, logarithmic = false): [number, number] {
  const [a, b] = logarithmic ? domain.map(Math.log) : domain;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return domain;
  const span = (b - a) / factor;
  const center = (a + b) / 2 + offset * (b - a);
  const result: [number, number] = [center - span / 2, center + span / 2];
  return logarithmic ? [Math.exp(result[0]), Math.exp(result[1])] : result;
}
/** Keep the value under the pointer fixed as the display range changes. */
export function zoomAt(current: number, offset: number, multiplier: number, anchor: number) {
  const factor = Math.max(1, Math.min(64, current * multiplier));
  const limit = 0.5 - 0.5 / factor;
  const next = offset + (Math.max(0, Math.min(1, anchor)) - 0.5) * (1 / current - 1 / factor);
  return { factor, offset: factor === 1 ? 0 : Math.max(-limit, Math.min(limit, next)) };
}

