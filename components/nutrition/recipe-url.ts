/**
 * Recognising a recipe URL, in one place (BF-11c).
 *
 * Both the plan wizard's meal picker and Build a Meal accept a pasted recipe link, and both have to
 * agree on what counts as one — so this is shared rather than written twice. The rule that matters
 * is the second one below: `https:` only, because `/api/nutrition/scan` refuses every other scheme
 * outright, and offering a mode the server rejects is worse than not offering it.
 */

/**
 * The input as an `https:` URL, or null.
 *
 * Parsed with `new URL()` and compared on `protocol`, never matched as a prefix string — `http:`,
 * `file:` and `data:` all have to fall through to the text branch rather than be sent and refused.
 */
export function asHttpsUrl(text: string): string | null {
  try {
    const u = new URL(text)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

/** The site's name, as a placeholder until the recipe's own name comes back. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
