export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase().trim()
  const t = target.toLowerCase().trim()
  if (!q) return 0
  if (q === t) return 1
  if (t.includes(q) || q.includes(t)) return 0.8
  const qWords = q.split(/\s+/)
  const tWords = t.split(/\s+/)
  const shared = qWords.filter(w => tWords.some(tw => tw.includes(w) || w.includes(tw))).length
  return shared / Math.max(qWords.length, tWords.length)
}
