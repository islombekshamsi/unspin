"use client";

import { useRouter } from "next/navigation";
import { useState, type MouseEvent, type ReactNode } from "react";

const LEAVE_MS = 280;

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function modifiedClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

/** In-page link that eases to its target instead of jumping. */
export function SmoothAnchor({
  href,
  className,
  children,
}: {
  href: `#${string}`;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a className={className} href={href} onClick={(event) => scrollToHash(event, href)}>
      {children}
    </a>
  );
}

function scrollToHash(event: MouseEvent<HTMLAnchorElement>, href: `#${string}`) {
  if (modifiedClick(event)) return;
  const target = document.getElementById(href.slice(1));
  if (!target) return;
  event.preventDefault();
  const behavior = reducedMotion() ? "auto" : "smooth";
  target.scrollIntoView({ behavior, block: "start" });
  const focusTarget = () => target.focus({ preventScroll: true });
  if (behavior === "auto" || !("onscrollend" in window)) focusTarget();
  else document.addEventListener("scrollend", focusTarget, { once: true });
  history.pushState(null, "", href);
}

/** Workspace link. The landing page eases out, then the app route opens. */
export function OpenAppLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  return (
    <a
      className={className}
      href={href}
      aria-disabled={leaving || undefined}
      onClick={(event) => {
        if (modifiedClick(event) || leaving) return;
        event.preventDefault();
        if (reducedMotion()) {
          router.push(href);
          return;
        }
        const origin = event.currentTarget instanceof Element ? event.currentTarget : event.target;
        const page =
          origin instanceof Element ? origin.closest(".page") : document.querySelector(".page");
        setLeaving(true);
        if (!(page instanceof HTMLElement)) {
          router.push(href);
          return;
        }
        const animation = page.animate(
          [
            { opacity: 1, transform: "translateY(0)" },
            { opacity: 0, transform: "translateY(10px)" },
          ],
          { duration: LEAVE_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" },
        );
        animation.finished.then(
          () => router.push(href),
          () => router.push(href),
        );
      }}
    >
      {children}
    </a>
  );
}
