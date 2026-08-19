export interface ParsedRecipe {
  name: string | null
  ingredients: string[]
  /** Servings the recipe makes, or null when the page does not say. */
  yield: number | null
}

const JSON_LD_BLOCK = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]
}

function hasRecipeType(node: Record<string, unknown>): boolean {
  return asArray(node['@type']).some((t) => typeof t === 'string' && t.toLowerCase() === 'recipe')
}

/** Walk the whole document: @graph, nested arrays and plain objects all carry Recipe nodes. */
function findRecipeNode(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 6 || value === null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRecipeNode(item, depth + 1)
      if (found) return found
    }
    return null
  }
  const node = value as Record<string, unknown>
  if (hasRecipeType(node)) return node
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement']) {
    const found = findRecipeNode(node[key], depth + 1)
    if (found) return found
  }
  return null
}

/**
 * `recipeYield` is free-form across sites: 4, "4", "4 servings", "Serves 4", ["4 servings", "4"].
 * Take the first plain integer found; a fraction or a range yields null so the caller can ask
 * rather than silently importing a whole tray as one meal.
 */
export function parseRecipeYield(value: unknown): number | null {
  for (const candidate of asArray(value)) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 1) {
      return Math.round(candidate)
    }
    if (typeof candidate !== 'string') continue
    const match = candidate.match(/\d+/)
    if (!match) continue
    const n = Number(match[0])
    if (Number.isFinite(n) && n >= 1 && n <= 100) return n
  }
  return null
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
}

function cleanLine(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ' '))
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Read schema.org Recipe JSON-LD out of a page. Most recipe sites carry it, and it is exact and
 * free — the model is the fallback, not the first move. Returns null when the page has none.
 */
export function extractRecipeJsonLd(html: string): ParsedRecipe | null {
  JSON_LD_BLOCK.lastIndex = 0
  for (;;) {
    const block = JSON_LD_BLOCK.exec(html)
    if (!block) break
    let parsed: unknown
    try {
      parsed = JSON.parse(block[1].trim())
    } catch {
      continue // one malformed block must not lose the others
    }
    const node = findRecipeNode(parsed)
    if (!node) continue

    const ingredients = asArray(node.recipeIngredient ?? node.ingredients)
      .filter((v): v is string => typeof v === 'string')
      .map(cleanLine)
      .filter((v) => v.length > 0 && v.length <= 200)
    if (ingredients.length === 0) continue

    const rawName = node.name
    return {
      name: typeof rawName === 'string' && rawName.trim() ? cleanLine(rawName).slice(0, 120) : null,
      ingredients: ingredients.slice(0, 40),
      yield: parseRecipeYield(node.recipeYield),
    }
  }
  return null
}

/**
 * Flatten a page to readable text for the model fallback. Page markup is enormous and
 * attacker-controlled, so script/style/noscript bodies go first and the result is capped by
 * the caller — the model never sees raw HTML.
 */
export function extractReadableText(html: string): string {
  const stripped = html
    .replace(/<(script|style|noscript|svg|head|nav|header|footer|aside|form|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
  return decodeEntities(stripped.replace(/<[^>]*>/g, ' '))
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n')
    .trim()
}

/**
 * Pick the slice of a page most likely to be the recipe. Measured against a real page with no
 * JSON-LD: the first 4,000 characters of Wikipedia's banana bread article are navigation chrome
 * ("Jump to content", "Main menu"), so a head-of-page cap sends the model no food at all.
 * Nearly every recipe page has an "Ingredients" heading; start there when one exists.
 */
export function sliceAroundIngredients(text: string, maxChars: number): string {
  const heading = text.match(/^[^\S\n]*ingredients\b.*$/im)
  const start = heading?.index ?? 0
  return text.slice(start, start + maxChars).trim()
}
