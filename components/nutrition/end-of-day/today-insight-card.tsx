'use client'

import { BatteryMediumIcon } from 'lucide-react'

interface Props {
  text: string
}

export function TodayInsightCard({ text }: Props) {
  return (
    <div
      className="rounded-2xl border px-4 py-3.5"
      style={{
        borderColor: 'color-mix(in oklch, var(--accent-green) 30%, transparent)',
        background: 'linear-gradient(135deg, color-mix(in oklch, var(--accent-green) 12%, transparent), color-mix(in oklch, var(--accent-green) 2%, transparent))',
      }}
    >
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--accent-green)' }}>
        <BatteryMediumIcon className="w-3 h-3" /> Connecting the dots
      </p>
      <p className="text-sm leading-relaxed text-foreground/90">{text}</p>
    </div>
  )
}
