"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@trainingai/shared/utils";
import type { ExerciseSummary } from "@/app/api/weights-summary/route";

interface WeightsSummaryProps {
  exercises: ExerciseSummary[];
  loading: boolean;
  onRefresh: () => void;
}

export const WeightsSummary = ({ exercises, loading, onRefresh }: WeightsSummaryProps) => {
  const [collapsed, setCollapsed] = useState(false);

  const sessionNames = [...new Set(exercises.map(e => e.sessionName))].sort()
  const grouped = sessionNames.reduce<Record<string, ExerciseSummary[]>>((acc, name) => {
    acc[name] = exercises.filter(e => e.sessionName === name)
    return acc
  }, {})

  const hasData = exercises.length > 0;

  return (
    <div className="border-b bg-muted/30">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Latest Weights
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh"
          >
            <RefreshCwIcon className={cn("size-3", loading && "animate-spin")} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronDownIcon className="size-3" /> : <ChevronUpIcon className="size-3" />}
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className="px-4 pb-3">
          {loading && !hasData ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-3 w-24" />
                  {[1, 2, 3, 4].map((j) => (
                    <Skeleton key={j} className="h-3" />
                  ))}
                </div>
              ))}
            </div>
          ) : !hasData ? (
            <EmptyState title="No data yet." />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {sessionNames.map((tab) => {
                const rows = grouped[tab];
                if (!rows?.length) return null;
                return (
                  <div key={tab}>
                    <p className="mb-1.5 text-xs font-semibold text-brand">{tab}</p>
                    <div className="space-y-1">
                      {rows.map((e) => (
                        <div key={e.exercise} className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-xs text-foreground">{e.exercise}</span>
                          <span className={cn(
                            "shrink-0 text-xs tabular-nums",
                            e.weight === null
                              ? "text-muted-foreground"
                              : "font-semibold"
                          )}>
                            {e.weight !== null ? `${e.weight}kg` : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
