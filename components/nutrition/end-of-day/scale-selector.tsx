'use client'
interface Props {
  label: string
  low: string
  high: string
  value: number
  onChange: (v: number) => void
  color?: string
  // When supplied (worst → best, i.e. left → right on screen), the scale renders
  // "good on the right" with a word under every rung. The stored value keeps its
  // 1=best … 5=worst meaning, so on-screen position p (1..5) maps to value 6 − p.
  labels?: readonly string[]
}
export function ScaleSelector({ label, low, high, value, onChange, color = 'var(--muted-foreground)', labels }: Props) {
  if (labels && labels.length === 5) {
    const selectedPos = 6 - value // 1..5, left → right
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex gap-0.5 rounded-xl overflow-hidden h-11">
          {[1, 2, 3, 4, 5].map(pos => {
            const stored = 6 - pos
            const selected = value === stored
            const filled = pos <= selectedPos
            return (
              <button key={pos} type="button" onClick={() => onChange(stored)} aria-pressed={selected}
                aria-label={`${label}: ${labels[pos - 1]}`}
                className="flex-1 flex items-center justify-center text-sm font-bold transition-all active:scale-95"
                style={{
                  background: selected ? color : filled ? `${color}44` : `${color}18`,
                  color: selected ? '#000' : filled ? 'var(--foreground)' : `${color}88`,
                  boxShadow: selected ? `0 0 8px ${color}88` : 'none',
                }}>
                {pos}
              </button>
            )
          })}
        </div>
        <div className="grid grid-cols-5 gap-0.5 text-[10px] leading-tight text-muted-foreground">
          {labels.map((word, i) => (
            <span key={i} className={i === 0 ? 'text-left' : i === 4 ? 'text-right' : 'text-center'}>
              {word}
            </span>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex gap-0.5 rounded-xl overflow-hidden h-11">
        {[1, 2, 3, 4, 5].map(n => {
          const selected = value === n
          const filled = n <= value
          return (
            <button key={n} type="button" onClick={() => onChange(n)} aria-pressed={selected}
              className="flex-1 flex items-center justify-center text-sm font-bold transition-all active:scale-95"
              style={{
                background: selected ? color : filled ? `${color}44` : `${color}18`,
                color: selected ? '#000' : filled ? 'var(--foreground)' : `${color}88`,
                boxShadow: selected ? `0 0 8px ${color}88` : 'none',
              }}>
              {n}
            </button>
          )
        })}
      </div>
      <div className="grid grid-cols-5 gap-0.5 text-[10px] leading-tight text-muted-foreground">
        <span className="text-left">{low}</span>
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span className="text-right">{high}</span>
      </div>
    </div>
  )
}
