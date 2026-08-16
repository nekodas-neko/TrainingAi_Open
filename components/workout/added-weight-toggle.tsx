"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, PlusIcon } from "lucide-react";
import { WeightDial } from "@/components/ui/weight-dial";

interface AddedWeightToggleProps {
  value: number;
  onChange: (value: number) => void;
}

// Collapsible "added/assisted load" picker for bodyweight exercises (e.g. weighted
// pull-ups, assisted dips). Defaults open if a non-zero load is already set.
export function AddedWeightToggle({ value, onChange }: AddedWeightToggleProps) {
  const [open, setOpen] = useState(value !== 0);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold text-muted-foreground border border-dashed border-border"
      >
        {value === 0 ? (
          <><PlusIcon className="h-3 w-3" /> Add weight</>
        ) : (
          <>{value > 0 ? `+${value} kg added` : `${value} kg assisted`} <ChevronDownIcon className="h-3 w-3" /></>
        )}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-2">
      <div className="flex items-center justify-between mb-1 px-1">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Added weight</p>
        <button onClick={() => setOpen(false)} className="text-muted-foreground">
          <ChevronUpIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <WeightDial value={value} onChange={onChange} min={-50} max={100} step={1.25} unit="kg" visible={3} pill />
    </div>
  );
}
