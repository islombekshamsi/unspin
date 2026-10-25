import type { Metadata, Viewport } from "next";
import { UnspinLandingPage } from "@/components/landing/UnspinLandingPage";

export const metadata: Metadata = {
  title: "UNSPIN — From static files to usable data",
  description: "Turn charts, PDFs, and spreadsheets into data you can inspect, correct, chart, and export.",
};

export const viewport: Viewport = {
  themeColor: "#090A0B",
};

/** The workspace lives at /app; workspace links carrying ?source= or ?dataset= are redirected there in next.config.ts. */
export default function Home() {
  return <UnspinLandingPage appHref="/app" />;
}
