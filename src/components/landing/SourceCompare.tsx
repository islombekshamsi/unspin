"use client";

import { useId, useState } from "react";
import { NOAA_COMPARE_ROWS, NOAA_FILE, NOAA_SOURCE_HEADER, NOAA_SOURCE_ROWS } from "./noaaExample";
import { lc } from "./landingClass";

const PLOT_PATH = NOAA_COMPARE_ROWS.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
const DESEASONALIZED_PATH = NOAA_COMPARE_ROWS.map(
  (point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.deseasonalizedY}`,
).join(" ");
const FIRST = NOAA_COMPARE_ROWS[0];
const LAST = NOAA_COMPARE_ROWS[NOAA_COMPARE_ROWS.length - 1];
const AREA_PATH = FIRST && LAST ? `${PLOT_PATH} L${LAST.x} 128 L${FIRST.x} 128 Z` : "";

/**
 * Local before/after of NOAA lines 41–49.
 * Dragging the divider or choosing a month does not import a file or call a provider.
 */
export function SourceCompare() {
  const noteId = useId();
  const [active, setActive] = useState(0);
  const row = NOAA_COMPARE_ROWS[active] ?? NOAA_COMPARE_ROWS[0];

  return (
    <div className={lc("compareBlock")}>
      <div className={lc("sideLabels")}>
        <span>Original source</span>
        <span>UNSPIN workspace</span>
      </div>
      <div className={lc("compareFrame")}>
        <div className={lc("comparePane", "compareAfter")}>
          {row ? <WorkspacePane active={active} row={row} onSelect={setActive} /> : null}
        </div>
        <div className={lc("comparePane", "compareBefore")}>
          {row ? <SourcePane active={active} row={row} onSelect={setActive} /> : null}
        </div>
        <div className={lc("compareDivider")} aria-hidden="true" />
        <input
          className={lc("compareRange")}
          type="range"
          min={0}
          max={100}
          defaultValue={50}
          aria-label="Compare original source and UNSPIN workspace"
          aria-describedby={noteId}
          aria-valuetext="Divider at 50. Original source is on the left. UNSPIN workspace is on the right."
          onInput={(event) => {
            const input = event.currentTarget;
            const value = Number(input.value);
            input.parentElement?.style.setProperty("--reveal", `${value}%`);
            input.setAttribute(
              "aria-valuetext",
              `Divider at ${value}. Original source is on the left. UNSPIN workspace is on the right.`,
            );
          }}
        />
      </div>
      <p className={lc("compareHint")}>Drag to explore. Select a month to read its average.</p>
      <p id={noteId} className={lc("compareNote")}>
        Previously processed example using NOAA data. Lines 41–49 of the {NOAA_FILE.series} file, May–December 1974,
        shown as source text and as the same parsed rows. Not a chart extraction.
      </p>
    </div>
  );
}

function WrappedSource({ text }: { text: string }) {
  const parts = text.split(",");
  return parts.map((part, index) => (
    <span key={`${part}-${index}`}>
      {part}
      {index < parts.length - 1 ? (
        <>
          ,<wbr />
        </>
      ) : null}
    </span>
  ));
}

function SourcePane({
  active,
  row,
  onSelect,
}: {
  active: number;
  row: (typeof NOAA_COMPARE_ROWS)[number];
  onSelect: (index: number) => void;
}) {
  return (
    <div className={lc("paneBody")}>
      <p className={lc("paneBar")}>
        <span>{NOAA_FILE.name}</span>
        <span className={lc("frameMeta")}>Lines 41–49</span>
      </p>
      <div className={lc("sourceList")}>
        <p className={lc("sourceHead")}>
          <span className={lc("lineNo")}>41</span>
          <span>
            <WrappedSource text={NOAA_SOURCE_HEADER} />
          </span>
        </p>
        {NOAA_SOURCE_ROWS.map((source, index) => (
          <button
            key={source.line}
            type="button"
            className={lc("sourcePick")}
            aria-pressed={index === active}
            onClick={() => onSelect(index)}
            onFocus={() => onSelect(index)}
          >
            <span className={lc("lineNo")}>{source.line}</span>
            <span>
              <WrappedSource text={source.text} />
            </span>
          </button>
        ))}
      </div>
      <dl className={lc("fieldGrid")}>
        {(
          [
            ["year", row.year],
            ["month", row.month],
            ["decimal date", row.decimalDate],
            ["average", row.average],
            ["deseasonalized", row.deseasonalized],
            ["ndays", row.ndays],
            ["sdev", row.sdev],
            ["unc", row.unc],
          ] as const
        ).map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function WorkspacePane({
  active,
  row,
  onSelect,
}: {
  active: number;
  row: (typeof NOAA_COMPARE_ROWS)[number];
  onSelect: (index: number) => void;
}) {
  return (
    <div className={lc("paneBody")}>
      <p className={lc("paneBar")}>
        <span>Parsed table</span>
        <span className={lc("frameMeta")}>CSV import · average</span>
      </p>
      <div className={lc("workspaceSplit")}>
        <CompareChart active={active} row={row} onSelect={onSelect} />
        <div className={lc("tableScroll")}>
        <table className={lc("table", "compareTable")}>
          <caption className={lc("srOnly")}>
            Parsed month and average for NOAA lines 42 to 49. These are the same values as the source text.
          </caption>
          <thead>
            <tr>
              <th scope="col">month</th>
              <th scope="col">average</th>
            </tr>
          </thead>
          <tbody>
            {NOAA_COMPARE_ROWS.map((item, index) => (
              <tr key={item.line} data-active={index === active ? "true" : "false"} onClick={() => onSelect(index)}>
                <th scope="row">
                  <button
                    type="button"
                    className={lc("rowPick")}
                    aria-pressed={index === active}
                    onClick={() => onSelect(index)}
                  >
                    {item.label}
                  </button>
                </th>
                <td>{item.average}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

function CompareChart({
  active,
  row,
  onSelect,
}: {
  active: number;
  row: (typeof NOAA_COMPARE_ROWS)[number];
  onSelect: (index: number) => void;
}) {
  const move = (index: number) => {
    const next = Math.min(NOAA_COMPARE_ROWS.length - 1, Math.max(0, index));
    onSelect(next);
    return next;
  };

  return (
    <div
      className={lc("plot")}
      role="radiogroup"
      aria-label="Monthly average, May through December 1974"
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          const next = move(active + 1);
          focusPoint(event.currentTarget, next);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          const next = move(active - 1);
          focusPoint(event.currentTarget, next);
        } else if (event.key === "Home") {
          event.preventDefault();
          move(0);
          focusPoint(event.currentTarget, 0);
        } else if (event.key === "End") {
          event.preventDefault();
          const last = NOAA_COMPARE_ROWS.length - 1;
          move(last);
          focusPoint(event.currentTarget, last);
        }
      }}
    >
      <div className={lc("plotHits")}>
        <svg className={lc("chart", "compareChart")} viewBox="20 16 360 132" preserveAspectRatio="none" aria-hidden="true">
          <path d={AREA_PATH} className={lc("plotArea")} />
          <path d={DESEASONALIZED_PATH} className={lc("plotSeason")} />
          <path d={PLOT_PATH} className={lc("chartLine")} />
          <path d={`M${row.x} 24 L${row.x} 128`} className={lc("plotGuide")} />
        </svg>
        {NOAA_COMPARE_ROWS.map((point, index) => (
          <button
            key={point.line}
            type="button"
            role="radio"
            className={lc("plotPoint")}
            aria-checked={index === active}
            aria-label={`${point.label} ${point.year} average ${point.average}`}
            tabIndex={index === active ? 0 : -1}
            style={{ left: `${((point.x - 20) / 360) * 100}%`, top: `${((point.y - 16) / 132) * 100}%` }}
            onClick={() => onSelect(index)}
            onMouseEnter={() => onSelect(index)}
            onFocus={() => onSelect(index)}
          />
        ))}
      </div>
      <p className={lc("plotReadout")}>
        <span>
          {row.label} {row.year}
        </span>
        <strong>{row.average}</strong>
      </p>
      <p className={lc("plotLegend")}>
        <span>average</span>
        <span>deseasonalized</span>
      </p>
    </div>
  );
}

function focusPoint(group: HTMLElement, index: number) {
  const point = group.querySelectorAll<HTMLButtonElement>('[role="radio"]')[index];
  point?.focus();
}
