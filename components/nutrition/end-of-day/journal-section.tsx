'use client'

import { Textarea } from '@/components/ui/textarea'

interface Props {
  value: string
  onChange: (v: string) => void
}

export function JournalSection({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Journal
      </span>
      <Textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder="Anything worth noting about today? Stress, a late meal, poor sleep, a great session…"
        className="min-h-24 rounded-xl bg-muted/40"
      />
    </div>
  )
}
