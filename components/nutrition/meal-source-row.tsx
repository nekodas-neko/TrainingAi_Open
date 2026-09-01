'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Link2, Loader2, Sparkles } from 'lucide-react'
import { RecipeImageButton } from './recipe-image-button'
import { runRecipeImport, offlineHint, type ImportedRecipe } from './recipe-import-run'
import { asHttpsUrl, hostOf } from './recipe-url'
import type { RecipeCandidate } from './recipe-candidates'

interface Props {
  /** Changes the heading only. The imports append either way. */
  hasIngredients: boolean
  userId?: string
  onImported: (recipe: ImportedRecipe) => void
  onCandidates: (candidates: RecipeCandidate[]) => void
}

type Mode = null | 'link' | 'describe'

/**
 * Where a meal comes from, said out loud (BF-52).
 *
 * The owner: *"I dont see a URL option or does it just go into the add ingredients? Id rather it
 * just be an 'AI Meal builder' option; similar to the food logging where you can write/type to it -
 * or upload a photo; or upload a URL link etc."*
 *
 * **Every one of these already worked; none was findable.** The recipe-photo button, the URL import
 * and the per-ingredient AI estimate were *mutually exclusive renders of one slot* under a field
 * labelled "Search your foods or the food database…", chosen by what you had typed — so the URL
 * option did not exist until you had already pasted the URL. This row is the entry point that was
 * missing; the engine behind it is unchanged, because `/api/nutrition/scan` already takes
 * `{ image }`, `{ url }` and `{ text }` as three branches of one handler.
 *
 * **The barcode is deliberately NOT here**, against BF-52's own instruction. These three produce a
 * whole ingredient list; a barcode names one product. Under a heading that says *"start this meal
 * from"* a barcode tile promises it can build a meal from a packet, which it cannot — so it stays
 * beside the ingredient search, where BF-63 put it and where everything else adds one ingredient.
 */
export function MealSourceRow({ hasIngredients, userId, onImported, onCandidates }: Props) {
  const [mode, setMode] = useState<Mode>(null)
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [importing, setImporting] = useState(false)

  async function run(payload: Record<string, unknown>, fallbackName: string, emptyMessage: string) {
    setImporting(true)
    try {
      const outcome = await runRecipeImport(payload, fallbackName, userId)
      if (outcome.kind === 'empty') { toast.error(offlineHint() ?? emptyMessage); return }
      if (outcome.kind === 'error') { toast.error(offlineHint() ?? 'Could not read that recipe'); return }
      if (outcome.kind === 'candidates') onCandidates(outcome.candidates)
      else onImported(outcome.recipe)
      // Only on success: a failed import leaves what you typed, so the fix is one edit rather than
      // a re-type. Closing the field on failure is how a bad paste becomes a mystery.
      setMode(null)
      setUrl('')
      setText('')
    } finally {
      setImporting(false)
    }
  }

  const link = asHttpsUrl(url)

  return (
    <div className="space-y-2">
      <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {hasIngredients ? 'Add to this meal from' : 'Start this meal from'}
      </p>

      {/* The same three-tile shape as Log Food's capture row, which is the owner's own comparison
          and a row they have just learned one screen away. */}
      <div className="flex gap-2">
        <RecipeImageButton
          variant="tile"
          importing={importing}
          onPick={(image, mimeType) => void run(
            { image, mimeType, imageKind: 'recipe' }, 'Recipe', 'No recipe could be read from that image',
          )}
        />
        <SourceTile
          icon={<Link2 className="h-7 w-7 text-muted-foreground" />}
          label="Recipe link"
          active={mode === 'link'}
          disabled={importing}
          onClick={() => setMode(m => (m === 'link' ? null : 'link'))}
        />
        <SourceTile
          icon={<Sparkles className="h-7 w-7 text-muted-foreground" />}
          label="Describe it"
          active={mode === 'describe'}
          disabled={importing}
          onClick={() => setMode(m => (m === 'describe' ? null : 'describe'))}
        />
      </div>

      {mode === 'link' && (
        <div className="space-y-2">
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            // `url`, so the WebView offers a keyboard with a slash and a .com key rather than
            // sentence-casing the host.
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Paste a recipe link"
            aria-label="Recipe link"
            className="w-full min-h-[48px] rounded-xl border border-border bg-background px-3 text-sm"
          />
          <ImportButton
            disabled={!link || importing}
            importing={importing}
            label={link ? `Import the recipe from ${hostOf(link)}` : 'Import the recipe'}
            onClick={() => link && void run({ url: link }, hostOf(link), 'No recipe could be read from that page')}
          />
        </div>
      )}

      {mode === 'describe' && (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={3}
            placeholder="e.g. 500g beef mince, 400g tin tomatoes, an onion, 250g pasta, 100g cheddar"
            aria-label="Describe the meal"
            className="w-full rounded-xl border border-border bg-background p-3 text-sm"
          />
          <ImportButton
            disabled={text.trim().length < 3 || importing}
            importing={importing}
            label="Build the ingredient list"
            onClick={() => void run(
              { text: text.trim() }, text.trim().slice(0, 40), 'Nothing in that description read as ingredients',
            )}
          />
        </div>
      )}
    </div>
  )
}

function SourceTile(
  { icon, label, active, disabled, onClick }:
  { icon: React.ReactNode; label: string; active: boolean; disabled: boolean; onClick: () => void },
) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-expanded={active}
      // Padding-driven height, matching the Log Food capture tiles BF-73 measured at 79 px. A
      // `min-h-[Npx]` here would be inert: `globals.css` sets a bare element-selector floor on
      // buttons that beats the utility.
      className={`flex flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl border px-1 py-3.5 disabled:opacity-50 ${
        active ? 'border-brand/50 bg-brand/10' : 'border-border/60 bg-background/50 active:bg-muted/40'
      }`}
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </button>
  )
}

function ImportButton(
  { disabled, importing, label, onClick }:
  { disabled: boolean; importing: boolean; label: string; onClick: () => void },
) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full min-h-[48px] items-center gap-2 rounded-xl border border-brand/40 bg-brand/10 px-3 py-2 text-left active:bg-brand/5 disabled:opacity-50"
    >
      {importing
        ? <Loader2 className="h-4 w-4 flex-none animate-spin text-brand" />
        : <Sparkles className="h-4 w-4 flex-none text-brand" />}
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {importing ? 'Reading that recipe…' : label}
      </span>
    </button>
  )
}
