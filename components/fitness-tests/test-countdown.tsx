'use client'
import { useEffect, useRef, useState } from 'react'

export function TestCountdown({ onDone }: { onDone: () => void }) {
  const [n, setN] = useState(3)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  useEffect(() => {
    const id = setInterval(() => {
      setN((prev) => {
        if (prev <= 1) { clearInterval(id); onDoneRef.current(); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="flex h-full flex-col items-center justify-center pt-safe pb-safe">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">Get ready</p>
      <p className="text-8xl font-black tabular-nums" style={{ color: 'var(--color-brand)' }}>{n}</p>
    </div>
  )
}
