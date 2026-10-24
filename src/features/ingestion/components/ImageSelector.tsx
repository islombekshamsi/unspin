"use client";

import { useState } from "react";
import type { Source } from "@/contracts";
import { ErrorState } from "@/components/ui";
import { api } from "@/lib/api/client";
import { normalizedToPixelBox, type NormRect } from "@/server/sources/geometry";
import { RegionSelector } from "./RegionSelector";
import { cleanHint, SelectionFooter, type SubmitState } from "./SourceSelector";

export function ImageSelector({ source, state }: { source: Source; state: SubmitState }) {
  const info = source.image!;
  const [region, setRegion] = useState<NormRect | null>(null);
  const [hint, setHint] = useState("");
  const [imgError, setImgError] = useState(false);
  const box = region ? normalizedToPixelBox(region, info.orientedWidth, info.orientedHeight) : null;
  const whole = box && box.width === info.orientedWidth && box.height === info.orientedHeight;

  return (
    <div>
      {imgError ? (
        <ErrorState title="The image could not be displayed" message="The stored file could not be loaded. Upload it again." />
      ) : (
        <RegionSelector
          aspect={info.orientedWidth / info.orientedHeight}
          value={region}
          onChange={setRegion}
          wholeLabel="Whole image"
          surfaceLabel={`Region selection over ${source.filename}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- authorized private blob; must not go through the image optimizer */}
          <img
            src={api.sourceContentUrl(source.id)}
            alt={`Uploaded image ${source.filename}`}
            draggable={false}
            onError={() => setImgError(true)}
            className="absolute inset-0 h-full w-full select-none object-fill"
            style={{ imageOrientation: "from-image" }}
          />
        </RegionSelector>
      )}
      {box && (
        <p className="tabular mt-2 text-[12px] text-ink-muted">
          Selected {box.width} × {box.height} px at ({box.left}, {box.top}) of {info.orientedWidth} × {info.orientedHeight} px
        </p>
      )}
      <SelectionFooter
        scope={whole ? "The whole image will be processed." : "Only the selected region is processed. Anything outside it is ignored."}
        disclosure="When you start extraction (after a separate confirmation), only this cropped region is sent to Google Gemini. Values read from charts are estimates for you to review."
        hint={hint}
        onHintChange={setHint}
        canSubmit={!!region && !state.submitting}
        disabledReason={region ? undefined : "Select a region or choose “Whole image”."}
        onSubmit={() => region && void state.submit({ kind: "image_region", region, userHint: cleanHint(hint) })}
        state={state}
      />
    </div>
  );
}
