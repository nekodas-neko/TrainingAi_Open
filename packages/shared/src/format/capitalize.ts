/** "upper back" → "Upper back": the first letter only, unlike CSS `capitalize`, which title-cases every word. */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
