"use client";

export const RPE_COLORS: Record<number, string> = {
  5:  '#22c55e',
  6:  '#84cc16',
  7:  '#eab308',
  8:  '#f59e0b',
  9:  '#f97316',
  10: '#ef4444',
};

export const RPE_LABELS: Record<number, string> = {
  5:  'Very light',
  6:  'Light',
  7:  'Moderate',
  8:  'Hard',
  9:  'Very hard',
  10: 'Maximum',
};

interface RpeSliderProps {
  value: number;
  onChange: (value: number) => void;
}

export function RpeSlider({ value, onChange }: RpeSliderProps) {
  return (
    <div className="px-3 pb-3 pt-1">
      <div className="flex gap-0.5 h-11">
        {([6, 7, 8, 9, 10] as const).map((rpe, i) => {
          const color = RPE_COLORS[rpe];
          const selected = rpe === value;
          const filled = rpe <= value;
          return (
            <button
              key={rpe}
              onClick={() => onChange(rpe)}
              aria-pressed={selected}
              className={`flex-1 flex items-center justify-center text-[11px] font-bold transition-all active:scale-95 ${i === 0 ? 'rounded-l-lg' : ''} ${i === 4 ? 'rounded-r-lg' : ''}`}
              style={{
                background: selected ? color : filled ? `${color}44` : `${color}18`,
                // Dark text derived from the segment's own color reads clearly on its
                // light tint in both themes — a fixed white/black pair washed out in
                // light mode against the pale filled-but-unselected background (UI-3/4).
                color: selected ? '#000' : filled ? `color-mix(in srgb, ${color} 60%, black)` : `${color}66`,
                boxShadow: selected ? `0 0 8px ${color}88` : 'none',
              }}
            >
              {rpe}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-center mt-1.5 font-medium leading-none" style={{ color: RPE_COLORS[value] }}>
        RPE {value} · {RPE_LABELS[value]}
      </p>
    </div>
  );
}

// Legacy vertical strip — kept for the done-card RPE badge only (not used as an input anymore)
export { RPE_COLORS as default };
