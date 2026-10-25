/**
 * Public NOAA values used only as a landing illustration.
 * Checked against evaluation/inputs/noaa-gml-co2-mm-mlo-1974-05_2026-09.excerpt.csv
 * (670 lines: 40 leading `#` records, header on line 41, 629 data rows on lines 42–670).
 * First data row is line 42. Last row is 2026-09.
 * Citation requested in the file: Dr. Xin Lan, NOAA/GML (gml.noaa.gov/ccgg/trends/).
 * The 333.20 figure is not a NOAA measurement. It is the before/after shown by the
 * recorded product check in evaluation/results/walkthrough/OBSERVATIONS.md, which was then undone.
 */

export const NOAA_CITATION_URL = "https://gml.noaa.gov/ccgg/trends/";

export const NOAA_FILE = {
  name: "co2_mm_mlo.csv",
  publisher: "NOAA Global Monitoring Laboratory",
  series: "Mauna Loa CO₂ monthly means",
  skippedCommentLines: "1–40",
  headerLine: 41,
  firstDataLine: 42,
  lastDataLine: 670,
  rowCount: 629,
  span: "May 1974–September 2026",
} as const;

export const NOAA_PREVIEW_ROWS = [
  { line: 42, year: "1974", month: "5", decimalDate: "1974.3750", average: "333.19", deseasonalized: "330.22" },
  { line: 43, year: "1974", month: "6", decimalDate: "1974.4583", average: "332.20", deseasonalized: "329.79" },
  { line: 44, year: "1974", month: "7", decimalDate: "1974.5417", average: "331.07", deseasonalized: "330.21" },
] as const;

/** Lines 42–49, column `average`, used to draw the linked illustration. */
export const NOAA_AVERAGE_MAY_DEC_1974 = [
  { month: "May", average: "333.19" },
  { month: "Jun", average: "332.20" },
  { month: "Jul", average: "331.07" },
  { month: "Aug", average: "329.15" },
  { month: "Sep", average: "327.33" },
  { month: "Oct", average: "327.28" },
  { month: "Nov", average: "328.31" },
  { month: "Dec", average: "329.58" },
] as const;

/**
 * Plot of NOAA_AVERAGE_MAY_DEC_1974 in a 360×168 viewBox.
 * y = 128 - (value - 326) / 9 * 112, x from 44 to 348. No value was rounded before plotting
 * except the final SVG coordinate, to 1 decimal place.
 */
export const NOAA_AVERAGE_PLOT = [
  { month: "May", average: "333.19", x: 44, y: 38.5 },
  { month: "Jun", average: "332.20", x: 87.4, y: 50.8 },
  { month: "Jul", average: "331.07", x: 130.9, y: 64.9 },
  { month: "Aug", average: "329.15", x: 174.3, y: 88.8 },
  { month: "Sep", average: "327.33", x: 217.7, y: 111.4 },
  { month: "Oct", average: "327.28", x: 261.1, y: 112.1 },
  { month: "Nov", average: "328.31", x: 304.6, y: 99.3 },
  { month: "Dec", average: "329.58", x: 348, y: 83.4 },
] as const;

export const NOAA_SOURCE_LINE = "1974,5,1974.3750,333.19,330.22,13,0.31,0.16";

/**
 * Same vertical scale as NOAA_AVERAGE_PLOT.
 * Input is a two-decimal string. y = 128 - (value - 326) / 9 * 112, rounded to 1 decimal.
 * Hundredths are converted with integer arithmetic so the scale does not depend on binary floats.
 */
export function noaaPlotY(decimal: string): number {
  const cents = Number(decimal.replace(".", ""));
  const y = 128 - ((cents - 32600) * 112) / 900;
  return Math.round(y * 10) / 10;
}

/** Exact excerpt text for the comparison card: header line 41 and data lines 42–49. */
export const NOAA_SOURCE_HEADER = "year,month,decimal date,average,deseasonalized,ndays,sdev,unc";

export const NOAA_SOURCE_ROWS = [
  { line: 42, text: NOAA_SOURCE_LINE },
  { line: 43, text: "1974,6,1974.4583,332.20,329.79,25,0.37,0.14" },
  { line: 44, text: "1974,7,1974.5417,331.07,330.21,24,0.24,0.09" },
  { line: 45, text: "1974,8,1974.6250,329.15,330.54,26,0.31,0.12" },
  { line: 46, text: "1974,9,1974.7083,327.33,330.44,22,0.47,0.19" },
  { line: 47, text: "1974,10,1974.7917,327.28,330.53,24,0.22,0.09" },
  { line: 48, text: "1974,11,1974.8750,328.31,330.50,26,0.43,0.16" },
  { line: 49, text: "1974,12,1974.9583,329.58,330.55,29,0.29,0.10" },
] as const;

/** Lines 42–49 parsed from NOAA_SOURCE_ROWS and tied to the existing May–Dec plot. */
export const NOAA_COMPARE_ROWS = NOAA_SOURCE_ROWS.map((row, index) => {
  const [year, month, decimalDate, average, deseasonalized, ndays, sdev, unc] = row.text.split(",");
  const plotted = NOAA_AVERAGE_PLOT[index];
  return {
    line: row.line,
    year,
    month,
    decimalDate,
    average,
    deseasonalized,
    ndays,
    sdev,
    unc,
    label: plotted?.month ?? "",
    x: plotted?.x ?? 0,
    y: plotted?.y ?? 0,
    deseasonalizedY: deseasonalized ? noaaPlotY(deseasonalized) : 0,
  };
});

export const NOAA_CORRECTION = {
  field: "average",
  line: 42,
  before: "333.19",
  after: "333.20",
  note: "Walkthrough check against NOAA source text.",
} as const;

export const NOAA_EXPORTS = [
  {
    id: "csv",
    label: "CSV",
    file: ".csv",
    purpose: "Spreadsheet-safe table of the selected version. Missing cells stay empty. Decimal text stays exact.",
  },
  {
    id: "json",
    label: "JSON",
    file: ".data.json",
    purpose: "Exact values for that version, including types and the reason a cell is missing.",
  },
  {
    id: "manifest",
    label: "Manifest",
    file: ".manifest.json",
    purpose: "Source, selection, dataset version, and the history of changes.",
  },
] as const;
