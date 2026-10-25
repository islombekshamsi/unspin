"use client";

import { useRef, useState } from "react";
import { lc } from "./landingClass";
import { WorkflowPreview, type WorkflowId } from "./WorkflowPreview";

const STEPS: readonly {
  id: WorkflowId;
  number: string;
  title: string;
  body: string;
}[] = [
  {
    id: "source",
    number: "01",
    title: "Start with the file you have",
    body: "Choose a chart region, PDF page, CSV records, or Excel sheet and range.",
  },
  {
    id: "inspect",
    number: "02",
    title: "Inspect values beside the source",
    body: "Select a value and see its source reference where available. Extracted chart values stay marked as estimates.",
  },
  {
    id: "correct",
    number: "03",
    title: "Make a change you can undo",
    body: "Preview a correction before applying it. Keep the history of what changed.",
  },
  {
    id: "export",
    number: "04",
    title: "Leave with usable data",
    body: "Export CSV, JSON, and a provenance manifest for the selected dataset version.",
  },
];

export function WorkflowFeatures() {
  const [active, setActive] = useState<WorkflowId>("source");
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const moveFocus = (index: number) => {
    const next = (index + STEPS.length) % STEPS.length;
    buttons.current[next]?.focus();
  };

  return (
    <div className={lc("workflowLayout")} data-active={active}>
      {STEPS.map((step, index) => {
        const open = step.id === active;
        const triggerId = `workflow-trigger-${step.id}`;
        const panelId = `workflow-panel-${step.id}`;
        return (
          <div key={step.id} className={lc("step")} data-step={step.id}>
            <h3 className={lc("stepHeading")}>
              <button
                ref={(node) => {
                  buttons.current[index] = node;
                }}
                type="button"
                id={triggerId}
                className={lc("trigger")}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setActive(step.id)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveFocus(index + 1);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveFocus(index - 1);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    buttons.current[0]?.focus();
                  } else if (event.key === "End") {
                    event.preventDefault();
                    buttons.current[STEPS.length - 1]?.focus();
                  }
                }}
              >
                <span className={lc("stepNumber")}>{step.number}</span>
                <span className={lc("stepTitle")}>{step.title}</span>
                <svg className={lc("chevron")} viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M3.5 6.25 8 10.75l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
            </h3>
            <div id={panelId} role="region" aria-labelledby={triggerId} className={lc("panel")} hidden={!open}>
              <p>{step.body}</p>
            </div>
          </div>
        );
      })}
      <WorkflowPreview active={active} />
    </div>
  );
}
