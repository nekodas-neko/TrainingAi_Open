"use client";

import { useEffect, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@trainingai/shared/utils";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { TTL_SHORT } from "@trainingai/shared/cache-ttl";
import type { ChoiceListArgs, WidgetColorKey } from "@/lib/coach/widgets";

type Option = NonNullable<ChoiceListArgs["options"]>[number];

const COLOR_VAR: Record<WidgetColorKey, string> = {
  cyan: "var(--accent-cyan)",
  green: "var(--accent-green)",
  amber: "var(--accent-amber)",
  purple: "var(--accent-purple)",
  destructive: "var(--destructive)",
};

/** Above this the list scrolls inside itself. A twelve-row widget pushes the composer off a
 *  412×891 screen, and a conversation whose input has vanished is not a conversation. */
const MAX_VISIBLE_ROWS = 6;
const ROW_HEIGHT_PX = 56;

interface ChoiceListProps {
  args: ChoiceListArgs;
  /** Absent once a newer turn exists — the widget renders inert rather than acting late. */
  onChoose?: (option: { id: string; label: string }) => void;
  disabled?: boolean;
}

export function ChoiceList({ args, onChoose, disabled }: ChoiceListProps) {
  const inert = disabled || !onChoose;

  /**
   * When the model named a `source` it wrote no rows at all — the app fills them from the user's
   * own data. That is the cheap path (a picker the model typed out cost ~554 output tokens, and
   * output tokens are nearly all of Coach's latency) and the safe one: it cannot invent an id it
   * never writes.
   */
  const key = args.source ? `coach-options:${args.source}:${args.sourceId ?? "all"}` : null;
  const [fetched, setFetched] = useState<Option[] | null>(null);
  const [failed, setFailed] = useState(false);

  // Seeded in an effect, never a useState initializer — a cache read in an initializer is a
  // hydration mismatch (CLAUDE.md, and the bug oura-battery-chip shipped).
  useEffect(() => {
    if (!key || !args.source) return;
    const seed = readCacheSync<{ options: Option[] }>(key);
    if (seed?.options) setFetched(seed.options);
    const qs = new URLSearchParams({ source: args.source });
    if (args.sourceId) qs.set("sourceId", args.sourceId);
    cachedFetch<{ options: Option[] }>(key, `/api/coach/options?${qs}`, TTL_SHORT, d => {
      if (d?.options) setFetched(d.options);
    }).catch(() => setFailed(true));
  }, [key, args.source, args.sourceId]);

  const options: Option[] = args.source ? fetched ?? [] : args.options ?? [];

  if (args.source && fetched === null && !failed) {
    return (
      <div className="rounded-2xl border border-border bg-muted/20 px-3.5 py-4">
        <span className="text-[12px] text-muted-foreground">Loading your options…</span>
      </div>
    );
  }

  // An empty list is a dead end the user cannot act on, so it says so rather than rendering a
  // header over nothing.
  if (options.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-3.5 py-4">
        <span className="text-[12px] text-muted-foreground">
          {failed ? "Couldn't load those options — ask again." : "Nothing to choose from here."}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-2xl border overflow-hidden",
        inert
          ? "border-dashed border-border bg-muted/20 opacity-60"
          : "border-[color-mix(in_oklch,var(--accent-purple)_28%,transparent)] bg-[color-mix(in_oklch,var(--accent-purple)_7%,transparent)]",
      )}
    >
      <div className="flex items-start gap-2 px-3.5 py-2.5 border-b border-border/60">
        {/* Two lines, not one: the schema allows 160 characters and a single truncated line cut
            most real prompts mid-question. Still clamped — an unbounded header would push the
            options themselves off a phone screen. */}
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground flex-1 min-w-0 line-clamp-2">
          {args.prompt}
        </span>
        {options.length > 1 && (
          <span className="text-[11px] tabular-nums text-muted-foreground flex-none leading-4">{options.length}</span>
        )}
      </div>

      <div
        className="overflow-y-auto"
        style={{ maxHeight: MAX_VISIBLE_ROWS * ROW_HEIGHT_PX }}
      >
        {options.map(option => (
          <div
            key={option.id}
            role="button"
            tabIndex={inert ? -1 : 0}
            aria-disabled={inert}
            onClick={() => !inert && onChoose?.({ id: option.id, label: option.title })}
            onKeyDown={e => {
              if (inert) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onChoose?.({ id: option.id, label: option.title });
              }
            }}
            className={cn(
              "flex items-center gap-3 px-3.5 border-b border-border/40 last:border-b-0",
              "min-h-[56px]",
              !inert && "cursor-pointer active:bg-muted/40 transition-colors",
            )}
          >
            {option.colorKey && (
              <span
                className="w-[3px] h-6 rounded-full flex-none"
                style={{ background: COLOR_VAR[option.colorKey] }}
              />
            )}
            <div className="flex-1 min-w-0 py-2">
              <div className="text-sm font-semibold leading-tight truncate">{option.title}</div>
              {option.subtitle && (
                <div className="text-[11.5px] text-muted-foreground truncate mt-0.5">{option.subtitle}</div>
              )}
            </div>
            {!inert && <ChevronRightIcon className="h-4 w-4 text-muted-foreground flex-none" />}
          </div>
        ))}
      </div>

      {inert && (
        <div className="px-3.5 py-2.5 text-[11px] text-muted-foreground border-t border-border/40">
          No longer current — ask again to reopen
        </div>
      )}
    </div>
  );
}
