"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { lc } from "./landingClass";

/**
 * Decorative source / data / chart planes.
 * Fine pointers spread the stack on hover. The button keeps it open for touch and keyboard.
 */
export function LayerStack() {
  const stackId = useId();
  const [open, setOpen] = useState(false);

  return (
    <div className={lc("layerStack")} data-open={open ? "true" : "false"}>
      <div id={stackId} className={lc("layerStage")}>
        <Layer index={0} label="Source">
          <SourcePlane />
        </Layer>
        <Layer index={1} label="Data">
          <DataPlane />
        </Layer>
        <Layer index={2} label="Chart">
          <ChartPlane />
        </Layer>
      </div>
      <button
        type="button"
        className={lc("layerToggle")}
        aria-expanded={open}
        aria-controls={stackId}
        onClick={() => setOpen((value) => !value)}
      >
        Explore the layers
      </button>
    </div>
  );
}

function Layer({ index, label, children }: { index: number; label: string; children: ReactNode }) {
  return (
    <div className={lc("layer")} style={{ "--i": index } as CSSProperties}>
      <div className={lc("plane")} aria-hidden="true">
        {children}
      </div>
      <span className={lc("layerLabel")}>{label}</span>
    </div>
  );
}

function SourcePlane() {
  return (
    <svg className={lc("planeArt")} viewBox="0 0 200 110">
      <rect x="28" y="16" width="144" height="78" rx="6" className={lc("planeSheet")} />
      <path d="M44 36h92M44 50h112M44 64h74M44 78h96" className={lc("planeRule")} />
    </svg>
  );
}

function DataPlane() {
  return (
    <svg className={lc("planeArt")} viewBox="0 0 200 110">
      <rect x="24" y="18" width="152" height="74" rx="6" className={lc("planeSheet")} />
      <path d="M24 38h152M24 58h152M24 78h152M72 18v74M120 18v74" className={lc("planeRule")} />
    </svg>
  );
}

function ChartPlane() {
  return (
    <svg className={lc("planeArt")} viewBox="0 0 200 110">
      <rect x="24" y="18" width="152" height="74" rx="6" className={lc("planeSheet")} />
      <path d="M40 78h128M40 78V32" className={lc("planeRule")} />
      <path d="M48 70L78 62L108 66L138 46L160 40" className={lc("planeChart")} />
    </svg>
  );
}
