import type { DateFormat } from "@/contracts";

/**
 * Explicit date parsing (client-safe, no Node APIs).
 *
 * Policy:
 *  - The user names the format; nothing is auto-detected.
 *  - date_only stores calendar dates "YYYY-MM-DD" with no time zone. Text that carries a time is refused
 *    rather than having its time dropped.
 *  - utc stores ISO instants "YYYY-MM-DDTHH:mm:ss.sssZ". Only ISO 8601 text with an explicit "Z" or
 *    offset is accepted; a local time without a zone is refused instead of being guessed.
 *  - "YYYY-MM" and "YYYY" are periods. They are stored as the period's first day and every such cell gets
 *    a note; the column's datePolicy.format records the period granularity.
 *  - Calendar validity is checked (no 31 April, leap years respected). Years are four digits.
 *  - Sub-millisecond fractions that are not zero are refused (an ISO instant here keeps milliseconds).
 */

export type DateParseResult =
  | { ok: true; value: string; valueType: "date" | "datetime"; period: "month" | "year" | null }
  | { ok: false; reason: string };

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function isValidCalendarDate(y: number, m: number, d: number): boolean {
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= days;
}

function calendar(y: number, m: number, d: number, period: "month" | "year" | null = null): DateParseResult {
  if (!isValidCalendarDate(y, m, d)) return { ok: false, reason: "Not a real calendar date." };
  return { ok: true, value: `${pad(y, 4)}-${pad(m)}-${pad(d)}`, valueType: "date", period };
}

const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

function parseIsoInstant(t: string, timezone: "date_only" | "utc"): DateParseResult {
  const m = ISO_INSTANT.exec(t);
  if (!m) return { ok: false, reason: "Not an ISO 8601 date or date-time." };
  if (timezone === "date_only") return { ok: false, reason: "Contains a time; the date-only policy would drop it." };
  const [, ys, mos, ds, hs, mis, ss, frac, zone] = m;
  if (!zone) return { ok: false, reason: "Has no time zone (Z or ±hh:mm); the time zone is not guessed." };
  const y = Number(ys), mo = Number(mos), d = Number(ds), h = Number(hs), mi = Number(mis), s = ss ? Number(ss) : 0;
  if (!isValidCalendarDate(y, mo, d)) return { ok: false, reason: "Not a real calendar date." };
  if (h > 23 || mi > 59 || s > 59) return { ok: false, reason: "Time is out of range." };
  const fracDigits = frac ?? "";
  if (fracDigits.length > 3 && /[1-9]/.test(fracDigits.slice(3))) {
    return { ok: false, reason: "Has sub-millisecond precision, which would be lost." };
  }
  const ms = Number(fracDigits.slice(0, 3).padEnd(3, "0"));
  let offsetMin = 0;
  if (zone !== "Z") {
    const zm = /^([+-])(\d{2}):?(\d{2})?$/.exec(zone)!;
    const oh = Number(zm[2]), om = Number(zm[3] ?? "0");
    if (oh > 14 || om > 59) return { ok: false, reason: "Time zone offset is out of range." };
    offsetMin = (zm[1] === "-" ? -1 : 1) * (oh * 60 + om);
  }
  const local = new Date(0);
  local.setUTCFullYear(y, mo - 1, d); // Date.UTC would map years < 100 to 19xx
  local.setUTCHours(h, mi, s, ms);
  const out = new Date(local.getTime() - offsetMin * 60_000);
  if (out.getUTCFullYear() < 1 || out.getUTCFullYear() > 9999) return { ok: false, reason: "Date is out of range." };
  return { ok: true, value: out.toISOString(), valueType: "datetime", period: null };
}

export function parseDateText(text: string, format: DateFormat, timezone: "date_only" | "utc"): DateParseResult {
  const t = text.trim();
  if (t === "") return { ok: false, reason: "Empty text is not a date; use “Mark missing” to mark it explicitly." };
  if (timezone === "utc" && format !== "ISO_8601") {
    return { ok: false, reason: "The UTC policy needs ISO 8601 text with an explicit time zone." };
  }
  let m: RegExpExecArray | null;
  switch (format) {
    case "ISO_8601":
      if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) {
        if (timezone === "utc") return { ok: false, reason: "A date without a time is not an instant; the time is not guessed." };
        return calendar(Number(m[1]), Number(m[2]), Number(m[3]));
      }
      return parseIsoInstant(t, timezone);
    case "YYYY-MM-DD":
      if (!(m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) return { ok: false, reason: "Does not match YYYY-MM-DD." };
      return calendar(Number(m[1]), Number(m[2]), Number(m[3]));
    case "MM/DD/YYYY":
      if (!(m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) return { ok: false, reason: "Does not match MM/DD/YYYY." };
      return calendar(Number(m[3]), Number(m[1]), Number(m[2]));
    case "DD/MM/YYYY":
      if (!(m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) return { ok: false, reason: "Does not match DD/MM/YYYY." };
      return calendar(Number(m[3]), Number(m[2]), Number(m[1]));
    case "DD.MM.YYYY":
      if (!(m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t))) return { ok: false, reason: "Does not match DD.MM.YYYY." };
      return calendar(Number(m[3]), Number(m[2]), Number(m[1]));
    case "YYYY-MM":
      if (!(m = /^(\d{4})-(\d{2})$/.exec(t))) return { ok: false, reason: "Does not match YYYY-MM." };
      return calendar(Number(m[1]), Number(m[2]), 1, "month");
    case "YYYY":
      if (!(m = /^(\d{4})$/.exec(t))) return { ok: false, reason: "Does not match YYYY." };
      return calendar(Number(m[1]), 1, 1, "year");
  }
}

/**
 * For "a/b/yyyy" or "a.b.yyyy" text: which day/month orders are possible.
 * Returns null when the text is not in that shape.
 */
export function dayMonthReadings(text: string): { separator: "/" | "." | "-"; dm: boolean; md: boolean } | null {
  const m = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[3]), y = Number(m[4]);
  return { separator: m[2] as "/" | "." | "-", dm: isValidCalendarDate(y, b, a), md: isValidCalendarDate(y, a, b) };
}
