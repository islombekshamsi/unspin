import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { CsvSyntaxError, decodeUtf8Text, suggestDelimiter, suggestHeader, tokenizeCsv } from "./csv-tokenizer";

describe("tokenizeCsv", () => {
  it("keeps quoted delimiters, escaped quotes, and embedded newlines with physical line spans", () => {
    const text = 'id,note,value\n1,"hello, world",3\n2,"line one\nline two\r\nline three",4\n3,"she said ""hi""",5\n';
    const t = tokenizeCsv(text, ",");
    expect(t.records.map((r) => r.fields)).toEqual([
      ["id", "note", "value"],
      ["1", "hello, world", "3"],
      ["2", "line one\nline two\r\nline three", "4"],
      ["3", 'she said "hi"', "5"],
    ]);
    expect(t.records.map((r) => [r.lineStart, r.lineEnd])).toEqual([
      [1, 1],
      [2, 2],
      [3, 5],
      [6, 6],
    ]);
  });

  it("handles CRLF, lone CR, mixed endings, and no trailing newline", () => {
    const t = tokenizeCsv("a,b\r\n1,2\r3,4\n5,6", ",");
    expect(t.records.map((r) => r.fields)).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
      ["5", "6"],
    ]);
    expect(t.records.map((r) => r.lineStart)).toEqual([1, 2, 3, 4]);
  });

  it("preserves blanks, whitespace, Unicode, and trailing empty fields exactly", () => {
    const t = tokenizeCsv("名前,값, x ,\n😀,,  ,\n", ",");
    expect(t.records.map((r) => r.fields)).toEqual([
      ["名前", "값", " x ", ""],
      ["😀", "", "  ", ""],
    ]);
  });

  it("skips and reports empty lines without shifting physical line numbers", () => {
    const t = tokenizeCsv("a,b\n\n1,2\r\n\r\n3,4\n", ",");
    expect(t.records.map((r) => r.fields)).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(t.emptyLines).toEqual([2, 4]);
    expect(t.records.map((r) => r.lineStart)).toEqual([1, 3, 5]);
  });

  it("fails loudly on an unterminated quote, naming the line where it opened", () => {
    expect(() => tokenizeCsv('a,b\n1,"open\n2,3\n', ",")).toThrow(CsvSyntaxError);
    try {
      tokenizeCsv('a,b\n1,"open\n2,3\n', ",");
    } catch (e) {
      expect((e as CsvSyntaxError).line).toBe(2);
    }
  });

  it("keeps text after a closing quote literally and reports the record", () => {
    const t = tokenizeCsv('a,b\n"x"y,2\n', ",");
    expect(t.records[1].fields).toEqual(["xy", "2"]);
    expect(t.malformedQuoteRecords).toEqual([1]);
  });

  it("agrees with Papa Parse on well-formed input", () => {
    const samples = [
      'a,b,c\n1,"2,3",4\n"x\ny",,z\n',
      "h1;h2\n1;2\n3;4",
      'q|r\n"a""b"|c\n',
      "x\ty\n1\t2\n",
    ];
    for (const s of samples) {
      const delimiter = s.includes(";") ? ";" : s.includes("|") ? "|" : s.includes("\t") ? "\t" : ",";
      const ours = tokenizeCsv(s, delimiter).records.map((r) => r.fields);
      const papa = Papa.parse<string[]>(s, { delimiter, skipEmptyLines: true }).data;
      expect(ours).toEqual(papa);
    }
  });
});

describe("decodeUtf8Text", () => {
  it("strips a BOM and reports it", () => {
    const r = decodeUtf8Text(new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x2c, 0x62]));
    expect(r).toEqual({ text: "a,b", hasBom: true });
  });
  it("rejects invalid UTF-8 and NUL bytes", () => {
    expect(decodeUtf8Text(new Uint8Array([0x61, 0xff, 0x62]))).toEqual({ error: "not_utf8" });
    expect(decodeUtf8Text(new Uint8Array([0x61, 0x00, 0x62]))).toEqual({ error: "nul_bytes" });
  });
});

describe("suggestions", () => {
  it("detects semicolon and tab delimiters even when commas appear inside values", () => {
    expect(suggestDelimiter("name;amount\nA;1,5\nB;2,25\n").delimiter).toBe(";");
    expect(suggestDelimiter("a\tb\tc\n1\t2,0\t3\n").delimiter).toBe("\t");
    expect(suggestDelimiter("only\none\ncolumn\n").delimiter).toBe(",");
  });

  it("suggests a header only for a text record above numeric columns", () => {
    const withHeader = tokenizeCsv("year,value\n2020,1.5\n2021,2.5\n", ",").records;
    expect(suggestHeader(withHeader).headerRecordCount).toBe(1);
    const noHeader = tokenizeCsv("2020,1.5\n2021,2.5\n", ",").records;
    expect(suggestHeader(noHeader).headerRecordCount).toBe(0);
  });
});
