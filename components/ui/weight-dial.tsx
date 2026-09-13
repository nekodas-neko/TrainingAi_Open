"use client";

import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { CheckIcon, CircleIcon } from "lucide-react";
import { cn } from "@trainingai/shared/utils";
import { hapticTick } from "@/lib/haptics";

const ITEM_HEIGHT = 48;

interface WeightDialProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /**
   * Makes the unit suffix on the SELECTED row a button (BF-141).
   *
   * **The control is the `kg` label itself**, because the owner asked for *"a very small button to
   * swap to lb - something you wouldnt see or hidden in away"*. A `SegmentedTabs` toggle was this
   * entry's first answer and is ruled out: it draws at 96 px tall, which is the opposite of hidden.
   * Tapping the suffix the dial already prints adds no chrome at all.
   *
   * Only the selected row's suffix is interactive — the unit renders on every visible row, and three
   * live toggles in a scrolling column is not what "hidden" means.
   */
  onUnitToggle?: () => void;
  recommendedValue?: number;
  visible?: number;
  pill?: boolean; // contained pill highlight — use inside overflow-hidden cards
}

export const WeightDial = ({
  value,
  onChange,
  min = 5,
  max = 250,
  step = 1.25,
  unit = "kg",
  onUnitToggle,
  recommendedValue,
  visible = 5,
  pill = false,
}: WeightDialProps) => {
  const VISIBLE = visible;
  const [containerHeight, setContainerHeight] = useState(VISIBLE * ITEM_HEIGHT);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHapticIndexRef = useRef<number>(-1);

  // Make dial height responsive: 35vh capped at 320px, minimum to fit visible items.
  // Snap to an odd multiple of ITEM_HEIGHT so the selected item is always perfectly centred.
  useEffect(() => {
    const updateHeight = () => {
      const vh = typeof window !== "undefined" ? window.innerHeight : 800;
      const responsiveHeight = Math.min(vh * 0.35, 320);
      const rawHeight = Math.min(responsiveHeight, VISIBLE * ITEM_HEIGHT);
      const count = Math.round(rawHeight / ITEM_HEIGHT);
      const oddCount = count % 2 === 0 ? count - 1 : count;
      setContainerHeight(oddCount * ITEM_HEIGHT);
    };
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, [VISIBLE]);

  const values = useMemo(() => {
    const arr: number[] = [];
    for (let v = min; v <= max; v = Math.round((v + step) * 1000) / 1000) {
      arr.push(v);
    }
    return arr;
  }, [min, max, step]);

  const indexOfValue = useCallback(
    (v: number) => Math.round((v - min) / step),
    [min, step]
  );

  const scrollToIndex = useCallback((index: number, smooth = true) => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: index * ITEM_HEIGHT, behavior: smooth ? "smooth" : "instant" });
  }, []);

  useEffect(() => {
    scrollToIndex(indexOfValue(value), false);
  }, [value, scrollToIndex, indexOfValue]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    // Fire haptic immediately on each new snap position as the scroll moves
    const immediateSnap = Math.max(0, Math.min(values.length - 1, Math.round(el.scrollTop / ITEM_HEIGHT)));
    if (immediateSnap !== lastHapticIndexRef.current) {
      lastHapticIndexRef.current = immediateSnap;
      hapticTick();
    }

    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      const snapped = Math.round(el.scrollTop / ITEM_HEIGHT);
      const clamped = Math.max(0, Math.min(values.length - 1, snapped));
      scrollToIndex(clamped);
      onChange(values[clamped]);
    }, 80);
  }, [onChange, scrollToIndex, values]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const currentIndex = indexOfValue(value);
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const next = Math.max(0, currentIndex - 1);
        scrollToIndex(next);
        onChange(values[next]);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.min(values.length - 1, currentIndex + 1);
        scrollToIndex(next);
        onChange(values[next]);
      }
    },
    [value, indexOfValue, scrollToIndex, onChange, values]
  );

  const paddingItems = Math.floor(containerHeight / ITEM_HEIGHT / 2);
  const isOnRecommended = recommendedValue !== undefined && value === recommendedValue;

  return (
    <div className="relative flex flex-col items-center select-none">
      <div
        className={cn(
          "pointer-events-none absolute z-10 border-2",
          pill ? "-inset-x-3 rounded-2xl" : "-left-3 -right-3 rounded-xl",
          isOnRecommended
            ? "bg-brand/30 border-brand"
            : "bg-brand/20 border-brand/70"
        )}
        style={{ top: paddingItems * ITEM_HEIGHT, height: ITEM_HEIGHT }}
      />
      {isOnRecommended && (
        <div
          className="pointer-events-none absolute right-0 z-20 flex items-center"
          style={{ top: paddingItems * ITEM_HEIGHT, height: ITEM_HEIGHT }}
        >
          <CheckIcon className="h-4 w-4 text-brand" strokeWidth={3} />
        </div>
      )}
      <div
        ref={containerRef}
        className="overflow-y-scroll scrollbar-hide outline-none"
        style={{ height: containerHeight, minWidth: pill ? "100px" : undefined, scrollSnapType: "y mandatory", touchAction: "pan-y" }}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="listbox"
        aria-label={`${unit} selector`}
      >
        {Array.from({ length: paddingItems }).map((_, i) => (
          <div key={`top-${i}`} style={{ height: ITEM_HEIGHT }} />
        ))}

        {values.map((v) => {
          const isSelected = v === value;
          const isRecommended = recommendedValue !== undefined && v === recommendedValue;
          const distance = Math.abs(indexOfValue(v) - indexOfValue(value));
          return (
            <div
              key={v}
              role="option"
              aria-selected={isSelected}
              style={{ height: ITEM_HEIGHT, scrollSnapAlign: "center" }}
              className={cn(
                "flex items-center justify-center font-mono transition-all duration-150 cursor-pointer",
                isSelected
                  ? "text-foreground text-2xl font-bold"
                  : isRecommended
                    ? "text-brand text-lg font-semibold"
                    : distance === 1
                      ? "text-muted-foreground text-lg"
                      : "text-muted-foreground/40 text-base"
              )}
              onClick={() => {
                scrollToIndex(indexOfValue(v));
                onChange(v);
              }}
            >
              {v}
              {unit && (isSelected && onUnitToggle ? (
                <button
                  type="button"
                  // **`stopPropagation`, and it guards a real case that is easy to think is
                  // hypothetical.** The whole row is a click target calling `onChange` with the
                  // row's own value — which in lb mode round-trips kg → lb (2.5 lb detent) → kg and
                  // is lossy for some weights: 61.0 kg comes back 61.25. So a unit tap that also
                  // reached the row would quietly rewrite the logged weight, which is this entry's
                  // whole subject. `e2e/weight-dial-unit-toggle.spec.ts` passes without this line
                  // because the seeded 60 kg round-trips exactly; that is a property of the fixture,
                  // not of the code.
                  onClick={(e) => { e.stopPropagation(); onUnitToggle(); }}
                  // `tap-dense` opts out of the 48 px floor `globals.css` forces on every button —
                  // which would blow this inline suffix up into a slab — and `tap-target-44` puts an
                  // invisible 44 px box back. Dial rows are 48 px tall, so the box stays inside its
                  // own row, which is that utility's stated rule.
                  className="tap-dense tap-target-44 ml-1 underline decoration-dotted decoration-muted-foreground/60 underline-offset-4"
                  aria-label={`Weight unit: ${unit}. Tap to change.`}
                >
                  {unit}
                </button>
              ) : (
                <span className="ml-1">{unit}</span>
              ))}
              {isRecommended && !isSelected && (
                <CircleIcon className="ml-1 inline h-2 w-2 fill-brand text-brand" />
              )}
            </div>
          );
        })}

        {Array.from({ length: paddingItems }).map((_, i) => (
          <div key={`bot-${i}`} style={{ height: ITEM_HEIGHT }} />
        ))}
      </div>
    </div>
  );
};
