"use client";

import { X, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { cn } from "@trainingai/shared/utils";

interface DismissibleBannerProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Body tap action (open a sheet, toggle expand). Omit for a purely informational banner. */
  onActivate?: () => void;
  /** Alternative to onActivate: body is a link. Mutually exclusive with onActivate. */
  href?: string;
  /** Show a chevron + set aria-expanded on the body. */
  expandable?: boolean;
  expanded?: boolean;
  onDismiss: () => void;
  dismissLabel?: string;
  /** Rendered under a divider when expanded. */
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

// Outer element is always a plain div (never a real button element) so it can legally
// contain other controls — the tappable body is a div with role="button", or a link.
// The dismiss control is a separate sibling button of its own, never nested inside the
// body (WebView nested-control anti-pattern — see CLAUDE.md's Android WebView Gotchas
// section).
export function DismissibleBanner({
  icon, title, subtitle, onActivate, href, expandable, expanded,
  onDismiss, dismissLabel = "Dismiss", children, className, style,
}: DismissibleBannerProps) {
  const bodyClass = "flex flex-1 items-center gap-3 min-w-0 text-left";
  const body = (
    <>
      {icon && <span className="flex-none">{icon}</span>}
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight">{title}</span>
        {subtitle && <span className="block text-[10px] text-muted-foreground">{subtitle}</span>}
      </span>
    </>
  );

  return (
    <div
      className={cn("mx-4 mb-3 rounded-2xl border border-border bg-card overflow-hidden", className)}
      style={style}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        {href ? (
          <a href={href} className={bodyClass}>{body}</a>
        ) : (
          <div
            role="button"
            tabIndex={0}
            aria-expanded={expandable ? expanded : undefined}
            onClick={onActivate}
            onKeyDown={e => {
              if (onActivate && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onActivate(); }
            }}
            className={cn(bodyClass, onActivate && "cursor-pointer")}
          >
            {body}
          </div>
        )}
        <div className="flex flex-none items-center gap-1">
          {expandable && (expanded
            ? <ChevronUpIcon className="h-4 w-4 text-muted-foreground" />
            : <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />)}
          <button
            type="button"
            aria-label={dismissLabel}
            onClick={e => { e.stopPropagation(); onDismiss(); }}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted/60 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {expandable && expanded && children && (
        <div className="border-t border-border px-4 pt-3 pb-4">{children}</div>
      )}
    </div>
  );
}
