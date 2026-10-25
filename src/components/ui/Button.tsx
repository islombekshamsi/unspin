"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-ink border border-accent hover:bg-accent-strong hover:border-accent-strong disabled:bg-rule-strong disabled:border-rule-strong disabled:text-ink-faint",
  secondary: "bg-surface text-ink border border-rule-strong hover:bg-raised disabled:text-ink-faint",
  ghost: "bg-transparent text-ink border border-transparent hover:bg-raised disabled:text-ink-faint",
  danger: "bg-surface text-danger border border-danger-rule hover:bg-danger-soft disabled:text-ink-faint",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3.5 text-[13px] gap-1.5",
  md: "h-10 px-5 text-[14px] gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center rounded-full font-medium whitespace-nowrap transition-[background-color,border-color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] enabled:active:scale-[0.98] disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required accessible name. */
  label: string;
  variant?: Variant;
  size?: Size;
}

export function IconButton({ label, variant = "ghost", size = "sm", className, children, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex items-center justify-center rounded-full transition-[background-color,border-color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        size === "sm" ? "h-8 w-8 px-0" : "h-10 w-10 px-0",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("h-3.5 w-3.5 animate-spin", className)} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
