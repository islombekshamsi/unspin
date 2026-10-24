import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { parseNumericText, type NumericParseOptions } from "./numeric";

const EN: NumericParseOptions = {
  locale: { decimalSeparator: ".", groupingSeparator: "," },
  groupingPolicy: "allow",
  percentPolicy: "reject",
  currencyPolicy: { mode: "reject" },
  parenthesesNegative: false,
};
const DE: NumericParseOptions = { ...EN, locale: { decimalSeparator: ",", groupingSeparator: "." } };

const value = (text: string, opts: NumericParseOptions = EN) => {
  const r = parseNumericText(text, opts);
  return r.ok ? r.value : `FAIL: ${r.reason}`;
};

describe("parseNumericText", () => {
  it("parses en and de locales to the same canonical decimal", () => {
    expect(value("1,234.50")).toBe("1234.50");
    expect(value("1.234,50", DE)).toBe("1234.50");
    expect(value("-0.75")).toBe("-0.75");
    expect(value("0,75", DE)).toBe("0.75");
    expect(value(".5")).toBe("0.5");
  });

  it("keeps significant trailing zeros and every written digit", () => {
    expect(value("1.50")).toBe("1.50");
    expect(value("100")).toBe("100");
    expect(value("2.000")).toBe("2.000");
  });

  it("keeps integers with 20+ digits exact (never via Number)", () => {
    const big = "123456789012345678901234567890";
    expect(value(big)).toBe(big);
    expect(value("123,456,789,012,345,678,901,234")).toBe("123456789012345678901234");
    expect(Number(big).toString()).not.toBe(big); // guard: Number would have lost digits
  });

  it("enforces the grouping policy", () => {
    expect(value("1,234", { ...EN, groupingPolicy: "forbid" })).toMatch(/^FAIL/);
    expect(value("1234.5", { ...EN, groupingPolicy: "forbid" })).toBe("1234.5");
    expect(value("12,34")).toMatch(/groups of three/);
    expect(value("1.234.567,8", DE)).toBe("1234567.8");
    expect(value("1 234,5", { ...DE, locale: { decimalSeparator: ",", groupingSeparator: " " } })).toBe("1234.5");
  });

  it("rejects the other locale's decimal separator instead of guessing", () => {
    expect(value("1.234,5")).toMatch(/^FAIL/);
    expect(value("12.5", DE)).toMatch(/^FAIL/);
  });

  it("applies each percent policy", () => {
    expect(value("12.5%")).toMatch(/percent sign/);
    const keep = parseNumericText("12.5 %", { ...EN, percentPolicy: "keep_percent_number" });
    expect(keep).toMatchObject({ ok: true, value: "12.5", hadPercent: true });
    expect(value("12.5%", { ...EN, percentPolicy: "to_fraction" })).toBe("0.125");
    expect(value("12.50%", { ...EN, percentPolicy: "to_fraction" })).toBe("0.1250");
    expect(value("-3%", { ...EN, percentPolicy: "to_fraction" })).toBe("-0.03");
    expect(value("150%", { ...EN, percentPolicy: "to_fraction" })).toBe("1.50");
    const frac = value("33.333333333333333333%", { ...EN, percentPolicy: "to_fraction" });
    expect(new Decimal(frac).eq(new Decimal("33.333333333333333333").div(100))).toBe(true);
  });

  it("strips only currency markers matching the explicit ISO currency", () => {
    const usd: NumericParseOptions = { ...EN, currencyPolicy: { mode: "strip_symbol", currency: "USD" } };
    expect(value("$1,200.00", usd)).toBe("1200.00");
    expect(value("-$5", usd)).toBe("-5");
    expect(value("$-5", usd)).toBe("-5");
    expect(value("5 USD", usd)).toBe("5");
    expect(value("€5", usd)).toMatch(/does not match/);
    expect(value("$5")).toMatch(/currency marker/);
    expect(value("12,50 €", { ...DE, currencyPolicy: { mode: "strip_symbol", currency: "EUR" } })).toBe("12.50");
  });

  it("accepts parentheses as negative only when asked", () => {
    expect(value("(123.4)")).toMatch(/Parentheses/);
    expect(value("(123.4)", { ...EN, parenthesesNegative: true })).toBe("-123.4");
    expect(value("($1,000)", { ...EN, parenthesesNegative: true, currencyPolicy: { mode: "strip_symbol", currency: "USD" } })).toBe("-1000");
    expect(value("(-5)", { ...EN, parenthesesNegative: true })).toMatch(/^FAIL/);
  });

  it("refuses identifier-like leading zeros, empty text, and junk", () => {
    expect(value("007")).toMatch(/leading zeros/);
    expect(value("0.07")).toBe("0.07");
    expect(value("")).toMatch(/Mark missing/);
    expect(value("12abc")).toMatch(/^FAIL/);
    expect(value("5.")).toMatch(/^FAIL/);
    expect(value("1.2.3")).toMatch(/^FAIL/);
    expect(value("--5")).toMatch(/^FAIL/);
  });

  it("keeps exponent notation and normalises negative zero", () => {
    expect(value("1.2E-5")).toBe("1.2e-5");
    expect(value("6.02e+23")).toBe("6.02e23");
    expect(value("-0.0")).toBe("0.0");
    expect(value("1.2e-5%", { ...EN, percentPolicy: "to_fraction" })).toBe("1.2e-7");
  });
});
