import { describe, expect, it } from 'vitest';
import { axisNumber, hasNumericPlotPoint, numericAxisWidth } from './axis-layout';

describe('stable chart axes and empty numeric views', () => {
  it('does not treat missing or nonfinite measurements as plottable zeros', () => {
    expect(hasNumericPlotPoint([{ x: 'room', y: null }])).toBe(false);
    expect(hasNumericPlotPoint([{ x: 1, y: NaN }, { x: Infinity, y: 2 }])).toBe(false);
    expect(hasNumericPlotPoint([{ x: 'room', y: 0 }])).toBe(true);
    expect(hasNumericPlotPoint([{ x: 1, y: -0.5 }])).toBe(true);
  });
  it('gives equal domains equal bounded widths without DOM measurement', () => {
    for (const domain of [[0, 0], [-1234567, 9000000], [0.000001, 0.000002], [1e100, 1e101]] as const) {
      expect(numericAxisWidth(domain)).toBe(numericAxisWidth([...domain]));
      expect(numericAxisWidth(domain)).toBeGreaterThanOrEqual(64);
      expect(numericAxisWidth(domain)).toBeLessThanOrEqual(128);
    }
    expect(numericAxisWidth(null)).toBe(80);
    expect(numericAxisWidth([NaN, Infinity])).toBe(80);
  });
  it('formats finite labels without rewriting original plot values', () => {
    expect(axisNumber(1.23000000000001)).toBe('1.23');
    expect(axisNumber(Infinity)).toBe('');
  });
});
