'use client'

import { memo, useEffect, useRef } from 'react'
import { Check, Copy, Trash2 } from 'lucide-react'
import { useCopy } from '@/lib/use-copy'

export const LogConsole = memo(function LogConsole({
  lines,
  onClear,
}: {
  lines: string[]
  onClear?: () => void
}) {
  const endRef = useRef<HTMLDivElement>(null)
  const copyRef = useRef<HTMLTextAreaElement>(null)
  const { copied, copy } = useCopy()
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'auto' }) }, [lines.length])

  const text = lines.join('\n')

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Log · {lines.length} lines</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => copy(text, copyRef.current)}
            disabled={lines.length === 0}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium disabled:opacity-40"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              disabled={lines.length === 0}
              aria-label="Clear log"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="h-64 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-[10px] leading-4 text-muted-foreground">
        {lines.map((l, i) => <div key={i} className="whitespace-pre-wrap break-all">{l}</div>)}
        <div ref={endRef} />
      </div>
      {/* Off-screen source for the WebView-compatible execCommand copy path. */}
      <textarea ref={copyRef} readOnly value={text} tabIndex={-1} aria-hidden className="pointer-events-none absolute -left-[9999px] h-px w-px opacity-0" />
    </div>
  )
})
