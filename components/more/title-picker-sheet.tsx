"use client";

import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { TITLES } from "@trainingai/shared/types/friends";

interface TitlePickerSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  unlockedAchievementIds: string[]
  currentTitle: string | null
  onEquip: (titleId: string | null) => void
}

export function TitlePickerSheet({ open, onOpenChange, unlockedAchievementIds, currentTitle, onEquip }: TitlePickerSheetProps) {
  const [equipping, setEquipping] = useState<string | null>(null);

  const availableTitles = Object.entries(TITLES).filter(([, def]) =>
    unlockedAchievementIds.includes(def.unlockedBy)
  );

  const handleEquip = async (titleId: string | null) => {
    setEquipping(titleId ?? '__none__');
    try {
      const res = await fetch('/api/user/equipped-title', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titleId }),
      });
      if (!res.ok) throw new Error('Failed to equip');
      onEquip(titleId);
      toast.success(titleId ? `Equipped "${TITLES[titleId].display}"` : 'Title removed');
    } catch {
      toast.error('Failed to equip title');
    } finally {
      setEquipping(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[80vh] flex flex-col">
        <SheetHeader className="border-b border-border/30 pb-3 shrink-0">
          <SheetTitle>Equip Title</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto pt-4 space-y-2">
          {/* Remove title option */}
          {currentTitle && (
            <button
              onClick={() => handleEquip(null)}
              disabled={!!equipping}
              className="w-full flex items-center gap-3 rounded-xl border border-border/40 bg-muted/20 p-3 text-left hover:bg-muted/40 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-muted/50 flex items-center justify-center">
                <span className="text-lg">—</span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-muted-foreground">No Title</p>
                <p className="text-xs text-muted-foreground/60">Remove equipped title</p>
              </div>
            </button>
          )}

          {availableTitles.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Unlock achievements to earn titles
            </p>
          ) : (
            availableTitles.map(([id, def]) => {
              const isEquipped = currentTitle === id;
              return (
                <button
                  key={id}
                  onClick={() => !isEquipped && handleEquip(id)}
                  disabled={!!equipping || isEquipped}
                  className="w-full flex items-center gap-3 rounded-xl border p-3 text-left transition-colors"
                  style={{
                    borderColor: isEquipped ? 'var(--color-brand)' : 'var(--border)',
                    background: isEquipped ? 'color-mix(in oklab, var(--color-brand) 10%, var(--color-background))' : undefined,
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: 'color-mix(in oklab, var(--color-brand) 15%, var(--color-background))' }}
                  >
                    <def.Icon className="w-4 h-4" style={{ color: 'var(--color-brand)' }} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold" style={{ color: isEquipped ? 'var(--color-brand)' : undefined }}>
                      {def.display}
                    </p>
                  </div>
                  {isEquipped && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--color-brand)', color: "var(--brand-foreground)" }}>
                      Equipped
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
