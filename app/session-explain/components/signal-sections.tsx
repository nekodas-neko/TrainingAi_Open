'use client'
import { useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { groupSignals } from '@trainingai/shared/session-explain/group-signals'
import type { SessionExplainData } from '@trainingai/shared/session-explain/build-explain-data'

const chipTone: Record<'warn' | 'ok', string> = {
  warn: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  ok:   'bg-green-500/15 text-green-400 border-green-500/30',
}

export function SignalSections({ data }: { data: SessionExplainData }) {
  const [open, setOpen] = useState(false)
  const groups = groupSignals(data)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border border-border bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold">The signals behind this</span>
        <ChevronDownIcon
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4 space-y-4">
        {groups.map(group => (
          <div key={group.heading} className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group.heading}</p>
            {group.rows.map(row => (
              <div key={row.label} className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">{row.label}</span>
                <span className="flex items-center gap-2 text-sm font-medium text-right">
                  {row.value}
                  {row.chip && (
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${chipTone[row.chip.tone]}`}>
                      {row.chip.text}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
