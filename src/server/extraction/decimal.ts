/**
 * Exact decimal canonicalization for model-read strings. Works on the text only;
 * values never pass through JavaScript Number, so precision and trailing zeros
 * survive. Anything needing interpretation (grouping separators, %, currency,
 * spaces, locale commas) is rejected and stays text for an explicit user decision.
 */

export interface CanonicalDecimal {
  /** Matches DecimalStringSchema. */
  value: string;
  /** Explanation when the canonical form differs from the shown text. */
  note: string | null;
}

const PLAIN = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
/** Exponents beyond double range would not be finite in any downstream numeric use. */
const MAX_ABS_EXPONENT = 308;

export function canonicalizeDecimal(raw: string): CanonicalDecimal | null {
  let text = raw.trim();
  const notes: string[] = [];
  if (text.startsWith("\u2212")) {
    text = `-${text.slice(1)}`;
    notes.push("A typographic minus sign (−) was read as a negative sign.");
  }
  const m = PLAIN.exec(text);
  if (!m) return null;
  const [, sign, intRaw, frac, exp] = m;
  if (!intRaw && !frac) return null;
  if (frac === "" && !intRaw) return null;
  if (exp !== undefined && Math.abs(parseInt(exp, 10)) > MAX_ABS_EXPONENT) return null;

  let intPart = intRaw.replace(/^0+(?=\d)/, "");
  if (intPart === "") intPart = "0";
  let out = `${sign === "-" ? "-" : ""}${intPart}`;
  if (frac) out += `.${frac}`;
  if (exp !== undefined) {
    const e = exp.replace(/^\+/, "");
    const neg = e.startsWith("-");
    const digits = e.replace(/^-/, "").replace(/^0+(?=\d)/, "");
    out += `e${neg ? "-" : ""}${digits}`;
  }
  if (out !== text && notes.length === 0) notes.push(`Shown as "${raw.trim()}"; stored as ${out}.`);
  return { value: out, note: notes.length ? notes.join(" ") : null };
}

/** Sign test on a canonical decimal string (no Number conversion). */
export function decimalSign(canonical: string): -1 | 0 | 1 {
  const negative = canonical.startsWith("-");
  const mantissa = canonical.replace(/^-/, "").split(/[eE]/)[0];
  if (/^0*(\.0*)?$/.test(mantissa)) return 0;
  return negative ? -1 : 1;
}
