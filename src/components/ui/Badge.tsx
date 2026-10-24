import type { ReactNode } from "react";
import { cx } from "./cx";

export type BadgeTone = "neutral" | "accent" | "estimate" | "danger" | "success";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-sunken text-ink-muted border-rule",
  accent: "bg-accent-soft text-accent-strong border-accent/30",
  estimate: "bg-estimate-soft text-estimate border-estimate-rule",
  danger: "bg-danger-soft text-danger border-danger-rule",
  success: "bg-success-soft text-success border-success/30",
};

/** Badges always carry text; color is never the only signal. */
export function Badge({
  tone = "neutral",
  icon,
  children,
  className,
  title,
}: {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
