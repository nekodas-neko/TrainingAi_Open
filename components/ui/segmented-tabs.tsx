"use client";

import { cn } from "@trainingai/shared/utils";

interface SegmentedTabsProps<T extends string> {
  tabs: readonly { value: T; label: string }[];
  value: T;
  onValueChange: (value: T) => void;
  size?: "sm" | "xs";
  /**
   * `vertical` stacks the segments in a column, for a toggle that sits beside a taller control
   * rather than above one (BF-46 ③). The 48 dp floor applies per segment either way, so a
   * two-option vertical toggle is 96 px tall and its neighbour has to be built to match — it does
   * not shrink to fit.
   */
  orientation?: "horizontal" | "vertical";
  className?: string;
}

export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onValueChange,
  size = "sm",
  orientation = "horizontal",
  className,
}: SegmentedTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-orientation={orientation}
      className={cn("flex gap-1", orientation === "vertical" && "flex-col", className)}
    >
      {tabs.map(t => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onValueChange(t.value)}
          className={cn(
            // Q-395a finding 7: 48 dp is the floor for a tap target (CLAUDE.md), and these segments were
            // the app's smallest at 44. One change here rather than eight at the call sites.
            "flex-1 rounded-xl py-2 font-semibold transition-colors min-h-12",
            size === "sm" ? "text-sm" : "text-xs",
            value === t.value
              ? "bg-foreground text-background"
              : "bg-muted/50 text-muted-foreground hover:bg-muted",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
