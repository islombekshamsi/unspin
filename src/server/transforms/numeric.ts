import Decimal from "decimal.js";
import { DecimalStringSchema, type NumericLocale } from "@/contracts";

/**
 * Explicit numeric parsing (client-safe, no Node APIs).
 *
 * Precision policy — "keep the digits as written":
 *  - Grouping separators are removed; the decimal separator becomes ".".
 *  - Every written digit is kept, including significant trailing zeros ("1.50" stays "1.50").
 *  - A missing integer digit is written out (".5" -> "0.5"); this does not change the value.
 *  - Exponent notation is kept as written with a lowercase "e" ("1.2E-5" -> "1.2e-5").
 *  - Negative zero is written without its sign ("-0.0" -> "0.0").
 *  - Integers with leading zeros ("007") are refused: they usually are identifiers.
 *  - Values never pass through JavaScript Number. decimal.js validates every result.
 *  - to_fraction divides by 100 exactly: two more decimal places are kept ("12.50%" -> "0.1250").
 */

export interface NumericParseOptions {
  locale: NumericLocale;
  groupingPolicy: "forbid" | "allow";
  percentPolicy: "reject" | "keep_percent_number" | "to_fraction";
  currencyPolicy: { mode: "reject" } | { mode: "strip_symbol"; currency: string };
  parenthesesNegative: boolean;
}

export type NumericParseResult =
  | { ok: true; value: string; hadPercent: boolean; hadCurrency: boolean; hadGrouping: boolean; hadParentheses: boolean }
  | { ok: false; reason: string };

/** Symbols each ISO currency may be written with. "$" and "¥" are shared, so the user's explicit choice decides. */
const CURRENCY_SYMBOLS: Record<string, string[]> = {
  "$": ["USD", "CAD", "AUD", "NZD", "HKD", "SGD", "MXN"],
  "US$": ["USD"],
  "€": ["EUR"],
  "£": ["GBP"],
  "¥": ["JPY", "CNY"],
  "₹": ["INR"],
  "₩": ["KRW"],
  "₽": ["RUB"],
  "₺": ["TRY"],
  "₴": ["UAH"],
  "₪": ["ILS"],
  "₦": ["NGN"],
  "₱": ["PHP"],
  "฿": ["THB"],
  "R$": ["BRL"],
  "CHF": ["CHF"],
  "Fr.": ["CHF"],
  "kr": ["SEK", "NOK", "DKK", "ISK"],
  "zł": ["PLN"],
};

const SYMBOLS_BY_LENGTH = Object.keys(CURRENCY_SYMBOLS).sort((a, b) => b.length - a.length);

/** Matches a currency marker (symbol or ISO code) at the start or end of a trimmed numeric string. */
export function detectCurrencyMarker(text: string): string | null {
  const t = text.trim();
  for (const s of SYMBOLS_BY_LENGTH) {
    if (t.startsWith(s) || t.endsWith(s)) return s;
  }
  const iso = /^([A-Z]{3})\s?[-+(\d]|[\d)]\s?([A-Z]{3})$/.exec(t);
  if (iso) return iso[1] ?? iso[2] ?? null;
  return null;
}

function stripCurrency(t: string): { rest: string; marker: string | null } {
  for (const s of SYMBOLS_BY_LENGTH) {
    if (t.startsWith(s)) return { rest: t.slice(s.length).trimStart(), marker: s };
    if (t.endsWith(s)) return { rest: t.slice(0, -s.length).trimEnd(), marker: s };
  }
  const pre = /^([A-Z]{3})\s?(.*)$/.exec(t);
  if (pre && /^[-+−(\d.,]/.test(pre[2])) return { rest: pre[2], marker: pre[1] };
  const post = /^(.*?)\s?([A-Z]{3})$/.exec(t);
  if (post && /[\d)]$/.test(post[1])) return { rest: post[1], marker: post[2] };
  return { rest: t, marker: null };
}

function stripSign(t: string): { rest: string; negative: boolean; signed: boolean } {
  const c = t[0];
  if (c === "-" || c === "\u2212") return { rest: t.slice(1), negative: true, signed: true };
  if (c === "+") return { rest: t.slice(1), negative: false, signed: true };
  return { rest: t, negative: false, signed: false };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function parseNumericText(text: string, opts: NumericParseOptions): NumericParseResult {
  const { decimalSeparator: dec, groupingSeparator: grp } = opts.locale;
  if (grp !== null && grp === dec) return { ok: false, reason: "The decimal and grouping separators are the same." };

  let t = text.trim();
  if (t === "") return { ok: false, reason: "Empty text is not a number; use “Mark missing” to mark it explicitly." };

  let hadParentheses = false;
  let negative = false;
  let signs = 0;
  let marker: string | null = null;

  const paren = /^\((.*)\)$/.exec(t);
  if (paren) {
    if (!opts.parenthesesNegative) return { ok: false, reason: "Parentheses are not accepted as negative under the chosen settings." };
    hadParentheses = true;
    negative = true;
    t = paren[1].trim();
  }

  // Sign and currency may appear in either order: "-$5", "$-5", "5 EUR".
  for (let pass = 0; pass < 2; pass++) {
    const s = stripSign(t);
    if (s.signed) {
      signs += 1;
      if (s.negative && hadParentheses) return { ok: false, reason: "Both parentheses and a minus sign are present." };
      if (s.negative) negative = true;
      t = s.rest.trimStart();
    }
    if (pass === 0) {
      const c = stripCurrency(t);
      marker = c.marker;
      t = c.rest;
    }
  }
  if (signs > 1) return { ok: false, reason: "More than one sign is present." };

  let hadPercent = false;
  if (/\s?%$/.test(t)) {
    hadPercent = true;
    t = t.replace(/\s?%$/, "");
    if (opts.percentPolicy === "reject") return { ok: false, reason: "Contains a percent sign, which the chosen settings reject." };
  }

  if (marker !== null) {
    if (opts.currencyPolicy.mode === "reject") return { ok: false, reason: `Contains a currency marker (“${marker}”), which the chosen settings reject.` };
    const iso = opts.currencyPolicy.currency;
    const allowed = marker.length === 3 && /^[A-Z]{3}$/.test(marker) ? [marker] : (CURRENCY_SYMBOLS[marker] ?? []);
    if (!allowed.includes(iso)) return { ok: false, reason: `Currency marker “${marker}” does not match the chosen currency ${iso}.` };
  }
  if (hadPercent && marker !== null) return { ok: false, reason: "Contains both a percent sign and a currency marker." };

  // Mantissa [exponent]
  let exponent = "";
  const exp = /^(.*?)[eE]([+-]?\d+)$/.exec(t);
  if (exp && /\d$/.test(exp[1])) {
    t = exp[1];
    exponent = exp[2].startsWith("+") ? exp[2].slice(1) : exp[2];
  }

  const parts = t.split(dec);
  if (parts.length > 2) return { ok: false, reason: `More than one decimal separator (“${dec}”).` };
  let intPart = parts[0];
  const fracPart = parts[1] as string | undefined;

  let hadGrouping = false;
  if (grp !== null && intPart.includes(grp)) {
    if (opts.groupingPolicy === "forbid") return { ok: false, reason: `Contains the grouping separator “${grp}”, which the chosen settings forbid.` };
    if (!new RegExp(`^\\d{1,3}(${escape(grp)}\\d{3})+$`).test(intPart)) {
      return { ok: false, reason: `Digit groups around “${grp}” are not groups of three.` };
    }
    hadGrouping = true;
    intPart = intPart.split(grp).join("");
  }
  if (fracPart !== undefined && fracPart === "") return { ok: false, reason: "Ends with a decimal separator." };
  if (intPart === "" && fracPart === undefined) return { ok: false, reason: "No digits." };
  if (!/^\d*$/.test(intPart) || (fracPart !== undefined && !/^\d+$/.test(fracPart))) {
    return { ok: false, reason: "Contains characters that are not digits or the chosen separators." };
  }
  if (intPart === "") intPart = "0";
  if (intPart.length > 1 && intPart.startsWith("0")) {
    return { ok: false, reason: "Has leading zeros, which usually mark an identifier; left as text." };
  }

  let body = fracPart !== undefined ? `${intPart}.${fracPart}` : intPart;
  if (hadPercent && opts.percentPolicy === "to_fraction") {
    if (exponent) {
      exponent = String(BigInt(exponent) - BigInt(2));
    } else {
      const dp = fracPart?.length ?? 0;
      body = new Decimal(body).div(100).toFixed(dp + 2);
    }
  }
  const isZero = new Decimal(exponent ? `${body}e${exponent}` : body).isZero();
  const value = `${negative && !isZero ? "-" : ""}${body}${exponent ? `e${exponent}` : ""}`;
  if (!DecimalStringSchema.safeParse(value).success) return { ok: false, reason: "Could not be written as an exact decimal." };
  return { ok: true, value, hadPercent, hadCurrency: marker !== null, hadGrouping, hadParentheses };
}

/** Classifies how a numeric-looking text value is written; null when it does not look numeric at all. */
export type NumericShape =
  | "plain_integer"
  | "plain_decimal_point"
  | "decimal_comma"
  | "grouped_comma"
  | "grouped_point"
  | "grouped_space"
  | "comma_ambiguous"
  | "point_ambiguous"
  | "percent"
  | "currency"
  | "parentheses"
  | "exponent";

export const SHAPE_LABELS: Record<NumericShape, string> = {
  plain_integer: "plain integer",
  plain_decimal_point: "decimal point",
  decimal_comma: "decimal comma",
  grouped_comma: "thousands grouped with “,”",
  grouped_point: "thousands grouped with “.”",
  grouped_space: "thousands grouped with spaces",
  comma_ambiguous: "“,” that could be a decimal or a thousands separator",
  point_ambiguous: "“.” that could be a decimal or a thousands separator",
  percent: "percent sign",
  currency: "currency marker",
  parentheses: "parentheses",
  exponent: "exponent notation",
};

export function numericShape(text: string): NumericShape | null {
  let t = text.trim();
  if (t === "" || t.length > 64) return null;
  if (/^\(.*\)$/.test(t)) return /\d/.test(t) ? "parentheses" : null;
  t = t.replace(/^[-+\u2212]/, "");
  if (detectCurrencyMarker(t) && /\d/.test(t)) return "currency";
  if (/^[\d.,\s\u00a0]+\s?%$/.test(t) && /\d/.test(t)) return "percent";
  if (/^\d+(\.\d+)?[eE][+-]?\d+$/.test(t)) return "exponent";
  if (/^\d+$/.test(t)) return "plain_integer";
  if (/^\d{1,3}(,\d{3})+\.\d+$/.test(t) || /^\d{1,3}(,\d{3}){2,}$/.test(t)) return "grouped_comma";
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(t) || /^\d{1,3}(\.\d{3}){2,}$/.test(t)) return "grouped_point";
  if (/^\d{1,3}([ \u00a0]\d{3})+([.,]\d+)?$/.test(t)) return "grouped_space";
  if (/^\d{1,3},\d{3}$/.test(t)) return "comma_ambiguous";
  if (/^\d{1,3}\.\d{3}$/.test(t)) return "point_ambiguous";
  if (/^\d*\.\d+$/.test(t)) return "plain_decimal_point";
  if (/^\d*,\d+$/.test(t)) return "decimal_comma";
  return null;
}
