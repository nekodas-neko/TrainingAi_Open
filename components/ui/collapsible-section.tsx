'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@trainingai/shared/utils'

interface CollapsibleSectionProps {
  title: string
  icon?: ReactNode
  /** Optional right-aligned content in the header (a status pill, a count, etc.). */
  right?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
  className?: string
}

/**
 * A bordered, self-contained collapsible section with a chevron header — the
 * "give this module its own chevron" primitive. Real button + `aria-expanded`
 * and a 44px-min header target, replacing the hand-rolled chevron toggles that
 * shipped without either.
 */
export function CollapsibleSection({
  title,
  icon,
  right,
  defaultOpen = false,
  children,
  className,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={cn('rounded-lg border border-border', className)}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 p-4 text-left text-sm font-medium"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
        <span>{title}</span>
        {right && <span className="ml-auto text-xs font-normal text-muted-foreground">{right}</span>}
      </button>
      {open && <div className="border-t border-border p-4 pt-3">{children}</div>}
    </section>
  )
}
