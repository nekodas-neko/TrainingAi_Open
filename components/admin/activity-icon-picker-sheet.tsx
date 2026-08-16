"use client";

import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { ACTIVITY_ICON_OPTIONS, getActivityIcon } from "@trainingai/shared/constants/activity-icons";

interface ActivityIconPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onSelect: (icon: string) => void;
}

export function ActivityIconPickerSheet({ open, onOpenChange, value, onSelect }: ActivityIconPickerSheetProps) {
  const [search, setSearch] = useState("");

  const filtered = ACTIVITY_ICON_OPTIONS.filter(opt =>
    opt.label.toLowerCase().includes(search.toLowerCase()) ||
    opt.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[80vh] flex flex-col">
        <SheetHeader className="border-b border-border/30 pb-3 shrink-0">
          <SheetTitle>Choose Icon</SheetTitle>
        </SheetHeader>
        <div className="pt-3 shrink-0">
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by activity (e.g. running, swim)..."
            className="h-9"
            autoFocus
          />
        </div>
        <div className="flex-1 overflow-y-auto pt-3">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No icons match &quot;{search}&quot;</p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {filtered.map(opt => {
                const Icon = getActivityIcon(opt.name);
                const selected = value === opt.name;
                return (
                  <button
                    key={opt.name}
                    type="button"
                    onClick={() => { onSelect(opt.name); onOpenChange(false); }}
                    className="flex flex-col items-center gap-1.5 rounded-xl border p-3 transition-colors active:scale-95"
                    style={{
                      borderColor: selected ? 'var(--color-brand)' : 'var(--border)',
                      background: selected ? 'color-mix(in oklab, var(--color-brand) 10%, var(--color-background))' : undefined,
                    }}
                  >
                    <Icon size={24} style={{ color: selected ? 'var(--color-brand)' : undefined }} />
                    <span className="text-[10px] text-muted-foreground text-center leading-tight truncate w-full">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
