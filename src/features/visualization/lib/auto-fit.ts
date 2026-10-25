export interface AxisDistribution {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  variance: number;
  sd: number;
  domain: [number, number] | null;
  outside: number;
}

/** Approximate display statistics only; exact source values are never rewritten.
 * A wide outer-IQR fence identifies isolated extremes. Focus only when at least
 * 90% remain and the retained span is under one quarter of the complete span.
 */
export function axisDistribution(input: readonly number[], logarithmic = false): AxisDistribution | null {
  const values = input.filter((n) => Number.isFinite(n) && (!logarithmic || n > 0)).sort((a, b) => a - b);
  if (!values.length) return null;
  const n = values.length;
  const quantile = (p: number) => {
    const index = (n - 1) * p; const low = Math.floor(index); const part = index - low;
    return values[low] * (1 - part) + values[Math.ceil(index)] * part;
  };
  let mean = 0; let m2 = 0;
  values.forEach((value, i) => { const delta = value - mean; mean += delta / (i + 1); m2 += delta * (value - mean); });
  const variance = n > 1 ? m2 / (n - 1) : 0;
  const stats: AxisDistribution = { count: n, min: values[0], max: values[n - 1], mean, median: quantile(0.5), variance, sd: Math.sqrt(variance), domain: null, outside: 0 };
  if (n < 12 || stats.max <= stats.min) return stats;
  const q1 = quantile(0.25); const q3 = quantile(0.75); const iqr = q3 - q1;
  const retained = values.filter((v) => v >= q1 - 3 * iqr && v <= q3 + 3 * iqr);
  if (retained.length < n * 0.9 || retained.length === n) return stats;
  const low = retained[0]; const high = retained[retained.length - 1];
  if (high - low > (stats.max - stats.min) * 0.25) return stats;
  let domain: [number, number];
  if (logarithmic) {
    const pad = Math.max((Math.log(high) - Math.log(low)) * 0.08, 0.05);
    domain = [Math.exp(Math.log(low) - pad), Math.exp(Math.log(high) + pad)];
  } else {
    const pad = Math.max((high - low) * 0.08, Math.abs(low) * 0.005, 0.000001);
    domain = [low - pad, high + pad];
  }
  if (!domain.every(Number.isFinite)) return stats;
  stats.domain = domain;
  stats.outside = values.filter((v) => v < domain[0] || v > domain[1]).length;
  return stats;
}

/** Never hide a whole series or more than 10% of any visible series. */
export function safeSeriesDomain(domain: [number, number] | null, series: readonly (readonly number[])[]) {
  if (!domain) return null;
  return series.every((values) => !values.length || values.filter((v) => v >= domain[0] && v <= domain[1]).length >= values.length * 0.9) ? domain : null;
}
