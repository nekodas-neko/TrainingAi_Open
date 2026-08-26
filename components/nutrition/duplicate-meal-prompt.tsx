'use client'

import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  /** The existing meal's name. A scalar, not the meal — the prompt needs nothing else from it. */
  existingName: string
  saving: boolean
  onUpdate: () => void
  onSaveAsNew: () => void
}

/**
 * "You already have something like this" (BF-11d).
 *
 * **It asks, it never merges.** A recipe link is easy to paste twice, and the alternative to asking
 * is either a silent duplicate or a silent overwrite — the second of which would rewrite a meal a
 * printed QR label already points at.
 *
 * **Save as new is one tap and is the safe default**, so the dangerous answer is the one that takes
 * a deliberate press. Dismissing the builder never overwrites anything.
 *
 * Rendered inline above the footer rather than as a dialog, the same shape `BulkDeleteConfirm` uses
 * on the list: a nested surface here would be another back-stack layer over a screen LB-16 just
 * finished flattening.
 *
 * **Deliberately not memoised**, unlike its siblings in this builder. Those sit above an ingredient
 * list and re-render on every keystroke; this one is mounted only while the question is on screen,
 * during which nothing else is being typed. A `memo()` here would buy nothing and would oblige every
 * call site to hoist two callbacks that exist for one press.
 */
export function DuplicateMealPrompt({
  existingName, saving, onUpdate, onSaveAsNew,
}: Props) {
  return (
    <div className="space-y-2.5 rounded-2xl border border-border bg-muted/40 p-3">
      <div className="flex items-start gap-2">
        <Copy className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold">You already have &ldquo;{existingName}&rdquo;</p>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Same name, and the macros match. Update it to replace its ingredients, or keep both.
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" className="min-h-12 flex-1" onClick={onUpdate} disabled={saving}>
          Update it
        </Button>
        <Button className="min-h-12 flex-1" onClick={onSaveAsNew} disabled={saving}>
          Save as new
        </Button>
      </div>
    </div>
  )
}
