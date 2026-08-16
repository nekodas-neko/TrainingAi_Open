"use client";

import { cn } from "@trainingai/shared/utils";

interface SegmentedTabsProps<T extends string> {
  tabs: readonly { value: T; label: string }[];
  value: T;
  onValueChange: (value: T) => void;
  size?: "sm" | "xs";
  className?: string;
}

export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onValueChange,
  size = "sm",
  className,
}: SegmentedTabsProps<T>) {
  return (
    <div role="tablist" className={cn("flex gap-1", className)}>
      {tabs.map(t => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onValueChange(t.value)}
          className={cn(
            "flex-1 rounded-xl py-2 font-semibold transition-colors min-h-11",
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
