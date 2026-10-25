import { LayerStack } from "./LayerStack";
import { SourceCompare } from "./SourceCompare";
import { lc } from "./landingClass";

export function LandingBento() {
  return (
    <section className={lc("bento")} aria-labelledby="bento-heading">
      <div className={lc("workflowIntro")}>
        <h2 id="bento-heading">See how it comes together.</h2>
      </div>
      <div className={lc("bentoGrid")}>
        <article className={lc("bentoCard")}>
          <LayerStack />
          <div className={lc("bentoCopy")}>
            <p className={lc("badge")}>Traceable by design</p>
            <h3 className={lc("bentoTitle")}>One source. A connected workspace.</h3>
            <p className={lc("bentoBody")}>
              Keep the original, your data, and the chart together. Inspect values, make reversible edits, and export with provenance.
            </p>
          </div>
        </article>
        <article className={lc("bentoCard")}>
          <SourceCompare />
          <div className={lc("bentoCopy")}>
            <h3 className={lc("bentoTitle")}>From static to usable.</h3>
            <p className={lc("bentoBody")}>
              Drag to compare the original source with an inspectable table and chart. Keep the source in view as you review the values.
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}
