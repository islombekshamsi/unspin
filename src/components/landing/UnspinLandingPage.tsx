import { LandingBento } from "./LandingBento";
import { LandingHero } from "./LandingHero";
import { NOAA_CITATION_URL } from "./noaaExample";
import { WorkflowFeatures } from "./WorkflowFeatures";
import { lc } from "./landingClass";
import { OpenAppLink, SmoothAnchor } from "./landingMotion";

/**
 * Landing page.
 * `appHref` is the upload/workspace entry (`/app`). Do not point it at the landing route itself.
 */
export function UnspinLandingPage({ appHref }: { appHref: string }) {
  const href = sitePath(appHref);

  return (
    <div className={lc("page")}>
      <SmoothAnchor className={lc("skip")} href="#content">
        Skip to content
      </SmoothAnchor>
      <main>
        <LandingHero appHref={href} />
        <div className={lc("wrap")}>
          <section id="workflow" tabIndex={-1} className={lc("workflow")} aria-labelledby="workflow-heading">
            <div className={lc("workflowIntro")}>
              <h2 id="workflow-heading">A clear path from source to export.</h2>
              <p>Keep the original in view. Inspect each value. Make changes you can undo.</p>
            </div>
            <WorkflowFeatures />
          </section>

          <LandingBento />

          <section className={lc("close")} aria-label="Open the workspace">
            <p className={lc("trust")}>
              <span className={lc("trustLine")}>Missing stays missing.</span>
              <span className={lc("trustLine")}>Estimates stay labelled.</span>
              <span className={lc("trustLine")}>Changes stay traceable.</span>
            </p>
            <OpenAppLink className={lc("pill")} href={href}>
              Open UNSPIN
            </OpenAppLink>
          </section>
        </div>
      </main>

      <div className={lc("wrap")}>
        <footer className={lc("footer")}>
          <p className={lc("footerBrand")}>UNSPIN</p>
          <p>
            Spreadsheets are parsed on this server. A chart or PDF region, or computed facts for optional analysis, are sent to Google Gemini only after you confirm.
            Values read from a chart stay marked as estimates.
          </p>
          <p>
            Example figures use NOAA Global Monitoring Laboratory Mauna Loa CO₂ monthly means.{" "}
            <a className={lc("footerLink")} href={NOAA_CITATION_URL}>
              Dr. Xin Lan, NOAA/GML
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}

function sitePath(href: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) {
    throw new Error("appHref must be a site path such as /.");
  }
  return href;
}
