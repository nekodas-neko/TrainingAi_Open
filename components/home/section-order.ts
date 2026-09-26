/**
 * Move one Home section to another's position (BF-205).
 *
 * **It operates on the FULL order, not the rendered subset**, which is the whole reason it is a
 * function rather than two lines at the call site. Home renders
 * `sectionOrder.filter(k => !hiddenSections.has(k))` and then drops any section whose content
 * comes back `null`, so the list on screen is a subset with gaps — dropping onto the third visible
 * card must not move the third stored key. Working in keys rather than indices makes the gaps
 * irrelevant.
 *
 * Returns the array unchanged when either key is unknown, so a drop that races a re-order (the
 * card-widget reconciliation rewrites this list when a widget is toggled) is a no-op rather than a
 * scramble.
 */
export function moveSection<T extends string>(order: readonly T[], fromKey: T, toKey: T): T[] {
  if (fromKey === toKey) return order as T[]
  const from = order.indexOf(fromKey)
  const to = order.indexOf(toKey)
  if (from === -1 || to === -1) return order as T[]
  const next = [...order]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
