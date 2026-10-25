import { HeroVisual } from "./HeroVisual";
import { lc } from "./landingClass";
import { OpenAppLink, SmoothAnchor } from "./landingMotion";

export function LandingHero({ appHref }: { appHref: string }) {
  return (
    <div className={lc("heroBand")}>
      <div className={lc("heroSheet")}>
        <HeroVisual />
        <header className={lc("topbar")}>
          <span className={lc("wordmark")}>UNSPIN</span>
          <OpenAppLink className={lc("pill", "heroCta")} href={appHref}>
            Open UNSPIN
          </OpenAppLink>
        </header>
        <div className={lc("heroFoot")}>
          <div className={lc("heroLead")}>
            <p className={lc("lede")}>
              Turn charts, PDFs, and spreadsheets into data you can inspect, correct, chart, and export.
            </p>
            <p className={lc("formats")}>PNG · JPG · WebP · PDF · CSV · XLSX</p>
          </div>
          <div className={lc("sheetBottom")}>
            <h1 id="content" tabIndex={-1} className={lc("headline")}>
              <span className={lc("headlineLine")}>From static files.</span>
              <span className={lc("headlineLine")}>To usable data.</span>
            </h1>
            <div className={lc("recess")}>
              <SmoothAnchor className={lc("recessLink")} href="#workflow">
                See how it works
                <ArrowIcon />
              </SmoothAnchor>
              <p className={lc("recessDetail")}>Inspect. Correct. Reuse.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg className={lc("arrow")} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M5 11L11 5M7 5h4v4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
