"use client";

import { useId, useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { AchievementResult } from "@/components/profile/achievements-grid";
import { ACHIEVEMENT_ICONS, CATEGORY_COLORS } from "@/components/profile/achievements-grid";
import { Dumbbell, Lock } from "lucide-react";
import { pinTrophy, trophySlots, unpinTrophy } from '@trainingai/shared/achievement-display';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCachedValue } from "@/lib/hooks/use-cached-value";
import { TROPHY_PINS_TTL } from "@trainingai/shared/cache-ttl";
import {
  TROPHY_PINS_KEY, TROPHY_PINS_URL, carryOverLegacyPins, readAccountPins, savePins,
} from "@/lib/trophy/trophy-pins-client";

interface TrophyCaseProps {
  achievements: AchievementResult[]
  readOnly?: boolean
  pinnedIds?: string[]
}

function BadgeSlot({ achievement, onUnpin }: { achievement?: AchievementResult; onUnpin?: () => void }) {
  if (!achievement) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/40 aspect-square bg-muted/10">
        <Lock className="w-5 h-5 text-muted-foreground/70" />
        <p className="text-[9px] text-muted-foreground/70 mt-1">Empty</p>
      </div>
    );
  }

  const { id, name, description, xpReward, category } = achievement;
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

/**
 * Your own trophy case: the pins are on the account, which is also what friends see. A friend's
 * case (`pinnedIds` given) is shown as it is and fetches nothing.
 */
export function TrophyCase({ achievements, readOnly = false, pinnedIds }: TrophyCaseProps) {
  if (pinnedIds !== undefined) {
    return <TrophyCaseView achievements={achievements} readOnly={readOnly} pinnedIds={pinnedIds} />;
  }
  return <OwnTrophyCase achievements={achievements} readOnly={readOnly} />;
}

function OwnTrophyCase({ achievements, readOnly }: { achievements: AchievementResult[]; readOnly: boolean }) {
  const account = useCachedValue<{ pins: string[] | null }>(
    TROPHY_PINS_KEY, TROPHY_PINS_URL, TROPHY_PINS_TTL,
    { onError: () => {} },
  );
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const unlockedKey = achievements.filter(a => a.unlocked).map(a => a.id).join(",");

  // The account's pins replace whatever is shown once they arrive, and again after a save refetches.
  useEffect(() => {
    if (account) setPinnedIds(account.pins ?? []);
  }, [account]);

  // The account's pins read from the server now. The cached value above paints at once but can be
  // older than a change made on another device, and a failed read leaves nothing known at all.
  const [confirmed, setConfirmed] = useState<{ pins: string[] | null } | null>(null);
  useEffect(() => {
    let alive = true;
    void readAccountPins().then(read => { if (alive) setConfirmed(read); });
    return () => { alive = false; };
  }, []);

  // Edit opens as soon as either read is in (`known` below), so the fresh read fills the case when
  // the cached one has failed or not landed yet; otherwise Edit would start from three empty slots and
  // a save would overwrite the account's real pins.
  useEffect(() => {
    if (confirmed && !account) setPinnedIds(confirmed.pins ?? []);
  }, [confirmed, account]);

  // The list this browser kept before pins lived on the account moves over once, and only after that
  // fresh read says the account has none; a cached `{ pins: null }` is not that.
  const carried = useRef(false);
  useEffect(() => {
    if (readOnly || !confirmed || carried.current || unlockedKey === "") return;
    carried.current = true;
    void carryOverLegacyPins(confirmed.pins, new Set(unlockedKey.split(",")));
  }, [readOnly, confirmed, unlockedKey]);

  // An edit saves the whole list, so it is held back while the account's pins are unknown: the
  // read failed and nothing is cached, which would otherwise show three empty slots to edit from.
  const known = account !== null || confirmed !== null;

  const change = async (next: string[]) => {
    const before = pinnedIds;
    setPinnedIds(next);
    if ((await savePins(next)) !== "saved") {
      setPinnedIds(before);
      toast.error("Couldn't save your trophy case");
    }
  };

  return (
    <TrophyCaseView
      achievements={achievements}
      readOnly={readOnly || !known}
      pinnedIds={pinnedIds}
      onPin={id => void change(pinTrophy(pinnedIds, id))}
      onUnpin={id => void change(unpinTrophy(pinnedIds, id))}
    />
  );
}

function TrophyCaseView({ achievements, readOnly, pinnedIds, onPin, onUnpin }: {
  achievements: AchievementResult[]
  readOnly: boolean
  pinnedIds: string[]
  onPin?: (id: string) => void
  onUnpin?: (id: string) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerId = useId();

  const unlockedAchievements = achievements.filter(a => a.unlocked);
  const slots = trophySlots(achievements, pinnedIds);

  const pin = (id: string) => {
    if (pinnedIds.includes(id)) return;
    onPin?.(id);
    setPickerOpen(false);
  };

  const unpin = (id: string) => onUnpin?.(id);

  return (
    <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Trophy Case</p>
        {!readOnly && (
          <button
            onClick={() => setPickerOpen(v => !v)}
            aria-expanded={pickerOpen}
            aria-controls={pickerId}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
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
        <div id={pickerId} className="mt-4 pt-4 border-t border-border/30">
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
