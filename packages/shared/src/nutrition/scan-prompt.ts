/**
 * Which question an image is asking (BF-40).
 *
 * `/api/nutrition/scan` takes an image for two different acts, and the **per-request line is the
 * only thing that distinguishes them** — the system prompt above it already understands recipes and
 * multi-dish pages. Handed a screenshot of an ingredient list, "analyse this food photo" instructs
 * the model to estimate a finished *plate* rather than read the *list*.
 *
 * Extracted and tested rather than inlined, for the same reason `recipeBuilderPatch` was: both
 * prompts are correct in isolation, and getting the choice wrong fails **silently** — dinner comes
 * back as a recipe, or a recipe comes back as one plated portion, and either reads as plausible.
 */
export type ScanImageKind = 'plate' | 'recipe'

/**
 * **Absent means `plate`.** Every caller that predates BF-40 sends no kind at all, so the default
 * has to reproduce the old behaviour exactly — which is why the plate strings below are verbatim,
 * note-case included, rather than merely equivalent.
 */
export function scanImageKind(raw: unknown): ScanImageKind {
  return raw === 'recipe' ? 'recipe' : 'plate'
}

/** Covers both things people mean by an image of ingredients: a written list, and them laid out. */
const RECIPE_PROMPT =
  'This image shows the INGREDIENTS of a recipe — either a written list (a recipe page, a screenshot, a handwritten note) or the raw ingredients laid out. ' +
  'Read the ingredients and their stated quantities; do not estimate a finished plated portion. ' +
  'Return the WHOLE recipe as written, at the quantities shown, without dividing it into servings.'

export function scanImagePrompt(kind: ScanImageKind, userNote: string): string {
  if (kind === 'recipe') {
    return userNote ? `${RECIPE_PROMPT} Additional context from user: "${userNote}".` : RECIPE_PROMPT
  }
  return userNote
    ? `Analyse this food photo. Additional context from user: "${userNote}". Return the nutrition JSON.`
    : 'Analyse this food photo and return the nutrition JSON.'
}
