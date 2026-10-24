import type { ReactNode } from "react";
import { cx } from "./cx";

export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="max-w-md text-[13px] leading-5 text-ink-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * Actionable failure. Shows the server's message and code; never replaced by a success card.
 */
export function ErrorState({
  title,
  message,
  code,
  requestId,
  action,
  className,
}: {
  title: string;
  message: string;
  code?: string;
  requestId?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div role="alert" className={cx("rounded-md border border-danger-rule bg-danger-soft px-4 py-3 text-left", className)}>
      <p className="flex items-center gap-2 text-sm font-semibold text-danger">
        <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" aria-hidden="true">
          <path d="M8 1.5 15 14H1L8 1.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M8 6v3.5M8 11.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        {title}
      </p>
      <p className="mt-1 text-[13px] leading-5 text-ink">{message}</p>
      {(code || requestId) && (
        <p className="mt-1 font-mono text-[11px] text-ink-muted">
          {code}
          {code && requestId ? " · " : ""}
          {requestId ? `ref ${requestId}` : ""}
        </p>
      )}
      {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

/** Neutral explanation for a capability that is honestly unavailable. */
export function UnavailableNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cx("rounded-md border border-dashed border-rule-strong bg-sunken px-3 py-2 text-[13px] leading-5 text-ink-muted", className)}>
      {children}
    </p>
  );
}
