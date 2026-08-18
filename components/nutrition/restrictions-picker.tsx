'use client'

import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@trainingai/shared/utils'
import type {
  DietaryRestriction, DietarySeverity, DietaryCategory,
} from '@trainingai/shared/types/nutrition'

export interface RestrictionSelection {
  restrictionId: string
  severity: DietarySeverity
}

interface Props {
  catalogue: DietaryRestriction[]
  selected: RestrictionSelection[]
  onChange: (next: RestrictionSelection[]) => void
  /** Free-text catch-all. Secondary to the picker — a taxonomy always misses something. */
  note: string
  onNoteChange: (note: string) => void
}

const CATEGORY_LABEL: Record<DietaryCategory, string> = {
  allergen: 'Allergens',
  diet_pattern: 'How you eat',
  dislike: 'Foods you skip',
}
const CATEGORY_ORDER: DietaryCategory[] = ['allergen', 'diet_pattern', 'dislike']

/**
 * Searchable multi-select over the seeded restriction catalogue.
 *
 * Matching runs over the label AND its synonyms, so "milk" finds Dairy and "shellfish" finds
 * Crustacean — a picker that only matched labels would send people looking for a row that is
 * there under another name.
 *
 * Tapping cycles off → avoid → allergy. The allergy state is visually distinct because it is what
 * the plan review renders back as a "must not contain" list. Note the deliberate absence of any
 * reassurance here: capturing this accurately does not make the model's filtering accurate, so
 * nothing in this component claims the plan will be safe.
 */
export function RestrictionsPicker({ catalogue, selected, onChange, note, onNoteChange }: Props) {
  const [query, setQuery] = useState('')

  const severityById = useMemo(
    () => new Map(selected.map(s => [s.restrictionId, s.severity])),
    [selected],
  )

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return catalogue
    return catalogue.filter(r =>
      r.label.toLowerCase().includes(q) ||
      r.code.toLowerCase().includes(q) ||
      r.synonyms.some(s => s.toLowerCase().includes(q)),
    )
  }, [catalogue, query])

  const grouped = useMemo(() => {
    const out = new Map<DietaryCategory, DietaryRestriction[]>()
    for (const r of matches) {
      const list = out.get(r.category) ?? []
      list.push(r)
      out.set(r.category, list)
    }
    return out
  }, [matches])

  function cycle(id: string) {
    const current = severityById.get(id)
    const next: RestrictionSelection[] = selected.filter(s => s.restrictionId !== id)
    if (current === undefined) next.push({ restrictionId: id, severity: 'avoid' })
    else if (current === 'avoid') next.push({ restrictionId: id, severity: 'allergy' })
    // 'allergy' → removed entirely, closing the cycle.
    onChange(next)
  }

  const chosen = catalogue.filter(r => severityById.has(r.id))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2.5">
        <Search className="w-3.5 h-3.5 text-muted-foreground flex-none" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder='Search — try "milk" or "shellfish"'
          aria-label="Search dietary restrictions"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <button onClick={() => setQuery('')} aria-label="Clear search" className="p-2 -m-2 text-muted-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {chosen.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            Selected
          </p>
          <div className="flex flex-wrap gap-2">
            {chosen.map(r => (
              <Chip
                key={r.id}
                label={r.label}
                severity={severityById.get(r.id)!}
                onClick={() => cycle(r.id)}
              />
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            Tap again to mark something an allergy, once more to remove it.
          </p>
        </div>
      )}

      {CATEGORY_ORDER.map(cat => {
        const items = grouped.get(cat)
        if (!items?.length) return null
        return (
          <div key={cat}>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              {CATEGORY_LABEL[cat]}
            </p>
            <div className="flex flex-wrap gap-2">
              {items.map(r => (
                <Chip
                  key={r.id}
                  label={r.label}
                  severity={severityById.get(r.id)}
                  onClick={() => cycle(r.id)}
                />
              ))}
            </div>
          </div>
        )
      })}

      {matches.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing matches “{query}”. Add it to the note below instead.
        </p>
      )}

      <div>
        <label
          htmlFor="restriction-note"
          className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2"
        >
          Anything else?
        </label>
        <textarea
          id="restriction-note"
          value={note}
          onChange={e => onNoteChange(e.target.value)}
          rows={2}
          placeholder="Optional — e.g. onions give me migraines"
          className="w-full rounded-xl border border-border bg-muted/50 px-3 py-2.5 text-sm outline-none resize-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  )
}

function Chip({ label, severity, onClick }: {
  label: string
  severity?: DietarySeverity
  onClick: () => void
}) {
  const isAllergy = severity === 'allergy'
  const isSelected = severity !== undefined
  return (
    <button
      onClick={onClick}
      aria-pressed={isSelected}
      className={cn(
        'min-h-[36px] rounded-full border px-3 text-xs font-medium transition-colors',
        !isSelected && 'border-border bg-muted/50 text-foreground active:bg-muted/30',
        isSelected && !isAllergy && 'border-brand/50 bg-brand/15 text-brand',
        isAllergy && 'border-destructive/50 bg-destructive/15 text-destructive',
      )}
    >
      {label}
      {/* Never colour alone — the state is spelled out. */}
      {isAllergy && <span className="ml-1.5 opacity-80">· allergy</span>}
    </button>
  )
}
