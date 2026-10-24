import { describe, expect, it } from "vitest";
import { dayMonthReadings, parseDateText } from "./dates";

const ok = (text: string, ...args: Parameters<typeof parseDateText> extends [string, ...infer R] ? R : never) => {
  const r = parseDateText(text, ...args);
  return r.ok ? r.value : `FAIL: ${r.reason}`;
};

describe("parseDateText", () => {
  it("reads each explicit calendar format", () => {
    expect(ok("2020-03-04", "YYYY-MM-DD", "date_only")).toBe("2020-03-04");
    expect(ok("03/04/2020", "MM/DD/YYYY", "date_only")).toBe("2020-03-04");
    expect(ok("03/04/2020", "DD/MM/YYYY", "date_only")).toBe("2020-04-03");
    expect(ok("4.3.2020", "DD.MM.YYYY", "date_only")).toBe("2020-03-04");
    expect(ok("2020-03-04", "ISO_8601", "date_only")).toBe("2020-03-04");
  });

  it("stores periods as their first day", () => {
    expect(parseDateText("2020-03", "YYYY-MM", "date_only")).toEqual({ ok: true, value: "2020-03-01", valueType: "date", period: "month" });
    expect(parseDateText("2020", "YYYY", "date_only")).toMatchObject({ ok: true, value: "2020-01-01", period: "year" });
  });

  it("checks calendar validity including leap years", () => {
    expect(ok("2020-02-29", "YYYY-MM-DD", "date_only")).toBe("2020-02-29");
    expect(ok("2019-02-29", "YYYY-MM-DD", "date_only")).toMatch(/^FAIL/);
    expect(ok("1900-02-29", "YYYY-MM-DD", "date_only")).toMatch(/^FAIL/);
    expect(ok("04/31/2020", "MM/DD/YYYY", "date_only")).toMatch(/^FAIL/);
    expect(ok("13/04/2020", "MM/DD/YYYY", "date_only")).toMatch(/^FAIL/);
  });

  it("converts ISO instants with offsets to UTC and refuses zone-less times", () => {
    expect(ok("2020-03-04T10:00:00+02:00", "ISO_8601", "utc")).toBe("2020-03-04T08:00:00.000Z");
    expect(ok("2020-03-04T23:30:00-05:00", "ISO_8601", "utc")).toBe("2020-03-05T04:30:00.000Z");
    expect(ok("2020-03-04T10:00:00.123Z", "ISO_8601", "utc")).toBe("2020-03-04T10:00:00.123Z");
    expect(ok("2020-03-04T10:00:00", "ISO_8601", "utc")).toMatch(/time zone/);
    expect(ok("2020-03-04", "ISO_8601", "utc")).toMatch(/not an instant/);
    expect(ok("2020-03-04T10:00:00Z", "ISO_8601", "date_only")).toMatch(/drop/);
    expect(ok("2020-03-04T10:00:00.1234Z", "ISO_8601", "utc")).toMatch(/sub-millisecond/);
    expect(ok("0050-01-01T00:00:00Z", "ISO_8601", "utc")).toBe("0050-01-01T00:00:00.000Z");
  });

  it("refuses the UTC policy for calendar formats", () => {
    expect(ok("03/04/2020", "MM/DD/YYYY", "utc")).toMatch(/ISO 8601/);
  });
});

describe("dayMonthReadings", () => {
  it("identifies ambiguous and one-sided day/month orders", () => {
    expect(dayMonthReadings("03/04/2020")).toEqual({ separator: "/", dm: true, md: true });
    expect(dayMonthReadings("13/04/2020")).toEqual({ separator: "/", dm: true, md: false });
    expect(dayMonthReadings("04/13/2020")).toEqual({ separator: "/", dm: false, md: true });
    expect(dayMonthReadings("2020-03-04")).toBeNull();
  });
});
