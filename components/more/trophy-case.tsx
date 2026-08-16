"use client";

import { useState, useEffect } from "react";
import type { AchievementResult } from "@/components/profile/achievements-grid";
import { ACHIEVEMENT_ICONS, CATEGORY_COLORS } from "@/components/profile/achievements-grid";
import { Dumbbell, Lock } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const TROPHY_KEY = "ta_trophy_case";
const SLOT_COUNT = 3;

function loadTrophy(): string[] {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(TROPHY_KEY) : null;
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveTrophy(ids: string[]) {
  try { localStorage.setItem(TROPHY_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
}

interface TrophyCaseProps {
  achievements: AchievementResult[]
  readOnly?: boolean
  pinnedIds?: string[]
}

function BadgeSlot({ achievement, onUnpin }: { achievement?: AchievementResult; onUnpin?: () => void }) {
  if (!achievement) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/40 aspect-square bg-muted/10">
        <Lock className="w-5 h-5 text-muted-foreground/30" />
        <p className="text-[9px] text-muted-foreground/40 mt-1">Empty</p>
      </div>
    );
  }

  const { id, name, description, xpReward, category, unlocked } = achievement;
  const Icon = ACHIEVEMENT_ICONS[id] ?? Dumbbell;
  const color = CATEGORY_COLORS[category] ?? 'var(--color-brand)';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="relative flex flex-col items-center justify-center rounded-2xl border p-3 aspect-square overflow-hidden transition-transform active:scale-95 w-full"
          style={{
            background: `color-mix(in oklab, ${color} 12%, var(--color-background))`,
            borderColor: color,
            boxShadow: `0 0 14px color-mix(in oklch, ${color} 30%, transparent)`,
          }}
        >
          <div className="absolute inset-0 opacity-10 blur-md pointer-events-none" style={{ background: color }} />
          <Icon className="h-10 w-10 mb-2 relative flex-none" style={{ color, filter: `drop-shadow(0 0 6px ${color})` }} />
          <p className="text-center text-[10px] font-semibold leading-tight line-clamp-2 px-0.5 relative" style={{ color }}>
            {name}
          </p>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-4" side="top" sideOffset={8}>
        <p className="font-bold text-sm mb-1" style={{ color }}>{name}</p>
        <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{description}</p>
        <div className="flex items-center justify-between text-xs mb-3">
          <span className="text-muted-foreground">Reward</span>
          <span className="font-bold" style={{ color }}>+{xpReward} XP</span>
        </div>
        {onUnpin && (
          <button
            onClick={onUnpin}
            className="w-full rounded-lg bg-muted/50 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors"
          >
            Remove from showcase
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function TrophyCase({ achievements, readOnly = false, pinnedIds: externalPinnedIds }: TrophyCaseProps) {
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => externalPinnedIds ?? loadTrophy());
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!externalPinnedIds) {
      const loaded = loadTrophy();
      setPinnedIds(loaded);
    }
  }, [externalPinnedIds]);

  const unlockedAchievements = achievements.filter(a => a.unlocked);
  const slots = Array.from({ length: SLOT_COUNT }, (_, i) => {
    const id = pinnedIds[i];
    return id ? achievements.find(a => a.id === id) : undefined;
  });

  const pin = (id: string) => {
    if (pinnedIds.includes(id)) return;
    const next = [...pinnedIds.filter(p => p !== id), id].slice(-SLOT_COUNT);
    setPinnedIds(next);
    saveTrophy(next);
    setPickerOpen(false);
  };

  const unpin = (id: string) => {
    const next = pinnedIds.filter(p => p !== id);
    setPinnedIds(next);
    saveTrophy(next);
  };

  return (
    <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Trophy Case</p>
        {!readOnly && (
          <button onClick={() => setPickerOpen(v => !v)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            {pickerOpen ? "Done" : "Edit"}
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {slots.map((a, i) => (
          <BadgeSlot
            key={i}
            achievement={a}
            onUnpin={!readOnly && a ? () => unpin(a.id) : undefined}
          />
        ))}
      </div>

      {!readOnly && pickerOpen && unlockedAchievements.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border/30">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Pin an Achievement</p>
          <div className="grid grid-cols-4 gap-2">
            {unlockedAchievements.map(a => {
              const Icon = ACHIEVEMENT_ICONS[a.id] ?? Dumbbell;
              const color = CATEGORY_COLORS[a.category] ?? 'var(--color-brand)';
              const isPinned = pinnedIds.includes(a.id);
              return (
                <button
                  key={a.id}
                  onClick={() => pin(a.id)}
                  disabled={isPinned}
                  className="relative flex flex-col items-center justify-center rounded-xl border p-2 aspect-square opacity-100 disabled:opacity-40 transition-opacity"
                  style={{
                    background: `color-mix(in oklab, ${color} 10%, var(--color-background))`,
                    borderColor: isPinned ? 'var(--color-brand)' : color,
                  }}
                >
                  <Icon className="h-6 w-6 mb-1" style={{ color }} />
                  <p className="text-[9px] font-semibold leading-tight line-clamp-2 text-center" style={{ color }}>
                    {a.name}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
