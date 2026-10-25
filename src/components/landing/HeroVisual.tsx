"use client";

import { useEffect, useRef } from "react";
import { lc } from "./landingClass";

/**
 * Decorative gradient for the hero sheet.
 * Pointer position updates CSS variables on this element only.
 * The painted gradients are complete when scripting or motion is off.
 */
export function HeroVisual() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;

    const fine = window.matchMedia("(pointer: fine)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!fine.matches) return;

    let frame = 0;
    let px = 0.58;
    let py = 0.46;
    let onScreen = true;

    const paint = () => {
      frame = 0;
      if (!onScreen || document.visibilityState === "hidden" || reduce.matches) return;
      el.style.setProperty("--hx", px.toFixed(4));
      el.style.setProperty("--hy", py.toFixed(4));
    };

    const onMove = (event: PointerEvent) => {
      if (reduce.matches || document.visibilityState === "hidden" || !onScreen) return;
      const bounds = host.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      px = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
      py = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
      if (frame === 0) frame = window.requestAnimationFrame(paint);
    };

    const onReduce = () => {
      if (!reduce.matches) return;
      el.style.removeProperty("--hx");
      el.style.removeProperty("--hy");
    };

    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? false;
    });
    observer.observe(el);
    host.addEventListener("pointermove", onMove, { passive: true });
    reduce.addEventListener("change", onReduce);

    return () => {
      host.removeEventListener("pointermove", onMove);
      reduce.removeEventListener("change", onReduce);
      observer.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} className={lc("visual")} aria-hidden="true">
      <div className={lc("wash")} />
      <div className={lc("highlight")} />
      <div className={lc("scrim")} />
    </div>
  );
}
