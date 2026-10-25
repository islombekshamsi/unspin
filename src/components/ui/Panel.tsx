import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  /** Controls rendered at the right of the header. */
  actions?: ReactNode;
  /** Region label for assistive technology when title is not plain text. */
  label?: string;
  bodyClassName?: string;
}

export function Panel({ title, actions, label, className, bodyClassName, children, ...rest }: PanelProps) {
  return (
    <section
      aria-label={label ?? (typeof title === "string" ? title : undefined)}
      className={cx("flex min-h-0 flex-col rounded-[24px] border border-rule bg-surface shadow-panel", className)}
      {...rest}
    >
      {(title || actions) && (
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-rule px-5 py-3">
          {title ? <h2 className="truncate text-[1.05rem] font-medium tracking-[-0.03em] text-ink-strong">{title}</h2> : <span />}
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cx("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}
