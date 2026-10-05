'use client'

import { memo } from 'react'
import { cn } from '@trainingai/shared/utils'
import type { Program } from '@trainingai/shared/types'

/**
 * BF-67 step 3 — pick an existing program for the generator to build the new one *similar to*.
 *
 * The engine half shipped 2026-08-31 and **had no caller**: `/api/generate-program` accepts
 * `referenceProgramId`, resolves it server-side against `listPrograms(userId)` so a program the
 * caller does not own is simply absent, and puts session names, exercise names, roles and styles
 * into the prompt. Nothing reached the owner, because nothing sent the field.
 *
 * **An id, never a program object** — that is the route's rule and this honours it: the control
 * emits an id and the structure is read server-side. Handing the structure up from here would be
 * an ownership hole and a prompt-injection surface for nothing the id does not already give.
 *
 * **Optional by construction.** No selection sends nothing and the generator behaves exactly as it
 * did, which is what makes this safe to put on an existing step instead of adding an eleventh one
 * and renumbering the wizard.
 *
 * Scalar props plus one array off the fetched payload — never an object literal at the call site,
 * which would defeat the `memo` silently (Q-490).
 */
export const ReferenceProgramPicker = memo(function ReferenceProgramPicker({
  programs, selectedId, onSelect,
}: {
  programs: Program[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  // Nothing to reference on a first program, and an empty picker explaining itself is furniture.
  if (programs.length === 0) return null

  return (
    <div className="space-y-2 pt-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Base it on an existing program
      </p>
      {/* The generator reads the reference's STRUCTURE — session and exercise names, roles,
          styles — not its numbers, so this says "similar to" rather than "copy of". */}
      <p className="text-2xs leading-snug text-muted-foreground">
        Optional. The generator sees its sessions and exercises and builds something similar.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-pressed={selectedId == null}
          className={cn(
            'rounded-xl border px-4 py-3 text-left text-sm font-semibold transition',
            selectedId == null ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-muted',
          )}
        >
          From scratch
        </button>
        {programs.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            aria-pressed={selectedId === p.id}
            className={cn(
              'rounded-xl border px-4 py-3 text-left text-sm font-semibold transition',
              selectedId === p.id ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-muted',
            )}
          >
            <span className="block truncate">{p.name}</span>
            {p.isActive && (
              <span className="block text-2xs font-normal text-muted-foreground">Current</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
})
