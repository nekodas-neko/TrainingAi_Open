/**
 * How a multi-select answer is written back to the model (Q-407).
 *
 * `WidgetResultSchema`'s own comment is the spec: the result "re-enters the model's context, so it
 * should read like something the user said rather than a serialised event". `["Coles","Aldi"]` is
 * the second thing; *"Coles and Aldi"* is the first.
 *
 * A `.ts` rather than a helper inside the registry component, for the reason `macro-energy.ts`
 * gives: both vitest projects run `environment: 'node'` and cannot parse JSX, so anything living in
 * a `.tsx` cannot be asserted at all. The slice-and-join below has an off-by-one in it that would
 * otherwise only ever be checked by reading.
 */
export function joinChoiceLabels(labels: readonly string[]): string {
  if (labels.length === 0) return ''
  if (labels.length === 1) return labels[0]
  // Two is not a special case: `slice(0, -1)` is a single label and joins to itself, so the general
  // line already produces "Coles and Aldi". A `length === 2` branch was written here first and
  // survived a mutation that deleted it — which is what said it was dead rather than defensive.
  // No Oxford comma: this is meant to read as speech, and the user would not say one.
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}
