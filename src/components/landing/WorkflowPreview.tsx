import {
  NOAA_AVERAGE_PLOT,
  NOAA_CORRECTION,
  NOAA_EXPORTS,
  NOAA_FILE,
  NOAA_PREVIEW_ROWS,
  NOAA_SOURCE_LINE,
} from "./noaaExample";
import { lc } from "./landingClass";

export type WorkflowId = "source" | "inspect" | "correct" | "export";

const CAPTIONS: Record<WorkflowId, string> = {
  source: `Example using NOAA data. A chosen record range in the ${NOAA_FILE.series} file. Not a live import.`,
  inspect: "Example using NOAA data. The selected average, 333.19, is the value on line 42. Not a live extraction.",
  correct: "Example using NOAA data. A correction preview from a recorded check. The published file still reads 333.19.",
  export: "Example using NOAA data. CSV, JSON, and a provenance manifest for one dataset version.",
};

export function WorkflowPreview({ active }: { active: WorkflowId }) {
  return (
    <figure className={lc("preview")}>
      <div className={lc("stage")}>
        <div key={active} className={lc("stageInner")}>
          {active === "source" ? <SourcePreview /> : null}
          {active === "inspect" ? <InspectPreview /> : null}
          {active === "correct" ? <CorrectPreview /> : null}
          {active === "export" ? <ExportPreview /> : null}
        </div>
      </div>
      <figcaption className={lc("caption")}>{CAPTIONS[active]}</figcaption>
    </figure>
  );
}

function SourcePreview() {
  return (
    <div className={lc("frame")}>
      <div className={lc("frameBar")}>
        <span>{NOAA_FILE.name}</span>
        <span className={lc("frameMeta")}>Lines {NOAA_PREVIEW_ROWS[0].line}–{NOAA_PREVIEW_ROWS[2].line}</span>
      </div>
      <p className={lc("frameNote")}>
        Skip {NOAA_FILE.skippedCommentLines} leading # records, chosen before import. Header on line {NOAA_FILE.headerLine}.{" "}
        {NOAA_FILE.rowCount} rows, {NOAA_FILE.span}.
      </p>
      <div className={lc("tableWrap")}>
        <table className={lc("table")}>
          <caption className={lc("srOnly")}>
            First three data rows of the NOAA monthly file. The highlighted cells are year, month, decimal date, and average.
          </caption>
          <thead>
            <tr>
              <th scope="col">year</th>
              <th scope="col">month</th>
              <th scope="col">decimal date</th>
              <th scope="col">average</th>
              <th scope="col" className={lc("hideNarrow")}>
                deseasonalized
              </th>
            </tr>
          </thead>
          <tbody>
            {NOAA_PREVIEW_ROWS.map((row, index) => (
              <tr key={row.line}>
                <td className={cellClass(index, "start")}>{row.year}</td>
                <td className={cellClass(index, "mid")}>{row.month}</td>
                <td className={cellClass(index, "mid")}>{row.decimalDate}</td>
                <td className={cellClass(index, "end")}>{row.average}</td>
                <td className={lc("hideNarrow")}>{row.deseasonalized}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={lc("rangeLabel")}>Shown range: lines 42–44, year through average.</p>
    </div>
  );
}

function cellClass(index: number, edge: "start" | "mid" | "end"): string {
  const parts = [lc("rangeCell")];
  if (index === 0) parts.push(lc("rangeTop"));
  if (index === NOAA_PREVIEW_ROWS.length - 1) parts.push(lc("rangeBottom"));
  if (edge === "start") parts.push(lc("rangeStart"));
  if (edge === "end") parts.push(lc("rangeEnd"));
  return parts.join(" ");
}

function InspectPreview() {
  const focus = NOAA_AVERAGE_PLOT[0];
  const [sourceBefore, sourceAfter] = NOAA_SOURCE_LINE.split("333.19");
  const path = NOAA_AVERAGE_PLOT.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");

  return (
    <div className={lc("frame")}>
      <div className={lc("frameBar")}>
        <span>Line {NOAA_FILE.firstDataLine}</span>
        <span className={lc("frameMeta")}>average · field 4</span>
      </div>
      <p className={lc("sourceLine")}>
        <span className={lc("lineNo")}>42</span>
        {sourceBefore}
        <mark className={lc("mark")}>333.19</mark>
        {sourceAfter}
      </p>
      <div className={lc("inspectGrid")}>
        <table className={lc("table")}>
          <caption className={lc("srOnly")}>Average column for the first three months, with May 1974 selected.</caption>
          <thead>
            <tr>
              <th scope="col">year</th>
              <th scope="col">month</th>
              <th scope="col">average</th>
            </tr>
          </thead>
          <tbody>
            {NOAA_PREVIEW_ROWS.map((row) => (
              <tr key={row.line}>
                <td>{row.year}</td>
                <td>{row.month}</td>
                <td className={row.line === 42 ? lc("selectedCell") : undefined}>
                  {row.average}
                  {row.line === 42 ? <span className={lc("selectedTag")}>Selected</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={lc("chartBlock")}>
          <p className={lc("chartLabel")}>average, ppm · May–Dec 1974</p>
          <svg className={lc("chart")} viewBox="0 0 380 168" role="img" aria-label="May through December 1974 average, with May selected at 333.19 ppm.">
            <path d={path} className={lc("chartLine")} />
            {NOAA_AVERAGE_PLOT.map((point) => (
              <circle key={point.month} cx={point.x} cy={point.y} r={point.month === "May" ? 4.5 : 2.4} className={point.month === "May" ? lc("chartFocus") : lc("chartDot")} />
            ))}
            <circle cx={focus.x} cy={focus.y} r="9" className={lc("chartRing")} />
            <text x={focus.x + 14} y={focus.y - 8} className={lc("chartText")}>
              333.19
            </text>
            <text x="44" y="156" className={lc("chartAxis")}>
              May
            </text>
            <text x="348" y="156" textAnchor="end" className={lc("chartAxis")}>
              Dec
            </text>
          </svg>
        </div>
      </div>
      <ul className={lc("legend")}>
        <li>
          <span className={lc("legendSolid")} aria-hidden="true" />
          Parsed from the file. CSV record 1, line 42, field 4.
        </li>
        <li>
          <span className={lc("legendDashed")} aria-hidden="true" />
          Values read from a chart image stay marked as estimates.
        </li>
      </ul>
    </div>
  );
}

function CorrectPreview() {
  return (
    <div className={lc("frame")}>
      <div className={lc("frameBar")}>
        <span>Correction preview</span>
        <span className={lc("frameMeta")}>Not applied</span>
      </div>
      <p className={lc("frameNote")}>
        {NOAA_CORRECTION.field} · line {NOAA_CORRECTION.line}
      </p>
      <div className={lc("compare")}>
        <div className={lc("compareCard")}>
          <p className={lc("compareLabel")}>Before</p>
          <p className={lc("compareValue")}>{NOAA_CORRECTION.before}</p>
          <p className={lc("compareKind")}>number</p>
        </div>
        <span className={lc("compareArrow")} aria-hidden="true">
          →
        </span>
        <div className={lc("compareCard")}>
          <p className={lc("compareLabel")}>After</p>
          <p className={lc("compareValue")}>{NOAA_CORRECTION.after}</p>
          <p className={lc("compareKind")}>number</p>
        </div>
      </div>
      <p className={lc("noteLabel")}>Note</p>
      <p className={lc("noteBody")}>{NOAA_CORRECTION.note}</p>
      <p className={lc("undoLine")}>Published source text stays {NOAA_CORRECTION.before}. Undo returns the cell to that value.</p>
    </div>
  );
}

function ExportPreview() {
  return (
    <div className={lc("frame")}>
      <div className={lc("frameBar")}>
        <span>Export</span>
        <span className={lc("frameMeta")}>Selected version</span>
      </div>
      <ul className={lc("exportList")}>
        {NOAA_EXPORTS.map((item) => (
          <li key={item.id} className={lc("exportItem")}>
            <div className={lc("exportId")}>
              <span className={lc("exportLabel")}>{item.label}</span>
              <span className={lc("exportFile")}>{item.file}</span>
            </div>
            <p className={lc("exportPurpose")}>{item.purpose}</p>
          </li>
        ))}
      </ul>
      <p className={lc("undoLine")}>
        These three files are written together. A recorded NOAA excerpt export included all three after the check edit was undone.
      </p>
    </div>
  );
}
