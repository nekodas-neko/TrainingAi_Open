"use client"

import { ILLNESS_CONTEXT_OPTIONS, type IllnessContext } from "@trainingai/shared/types/day-checkin"

interface Props {
  value: IllnessContext | null
  onChange: (v: IllnessContext | null) => void
}

// Q-113: replaces the Morning Check-in's "Motivation to train" scale. Single-select and
// exclusive — tapping the already-selected chip clears it back to null ("nothing going on"),
// so there's no separate "None" chip cluttering the row. Visual language matches
// sore-muscle-picker.tsx's pills for consistency across the checkin family.
export function IllnessContextPicker({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">Anything going on?</span>
      <div className="flex flex-wrap gap-1.5">
        {ILLNESS_CONTEXT_OPTIONS.map(opt => {
          const selected = value === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              role="checkbox"
              aria-checked={selected}
              onClick={() => onChange(selected ? null : opt.value)}
              className="min-h-9 rounded-full border px-3 py-1.5 text-xs font-medium transition-all active:scale-95"
              style={{
                borderColor: selected ? "var(--accent-amber)" : undefined,
                background: selected
                  ? "color-mix(in oklch, var(--accent-amber) 16%, transparent)"
                  : undefined,
                color: selected ? "var(--accent-amber)" : undefined,
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
