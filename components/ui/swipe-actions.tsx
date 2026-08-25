'use client'

import { useEffect, useRef, useState } from 'react'
import { useDrag } from '@use-gesture/react'
import { useReducedMotion } from 'motion/react'
import { cn } from '@trainingai/shared/utils'
import { ACTION_WIDTH, dragOffset, shouldRestOpen, trayWidth } from './swipe-actions-math'

export interface SwipeAction {
  key: string
  label: string
  icon: React.ReactNode
  onPress: () => void
  destructive?: boolean
}

interface Props {
  actions: SwipeAction[]
  /** Names the row these actions belong to, so each button reads as "Delete <meal>" to a reader. */
  itemLabel: string
  children: React.ReactNode
  className?: string
}

// Only one row rests open at a time — a list holding three half-open rows reads as a rendering
// fault rather than as a revealed tray. Module-level rather than context because the only thing
// shared is "close yourself", and a provider every list would have to remember to add is a
// provider that gets forgotten.
const openRows = new Set<() => void>()

/**
 * A list row whose secondary actions are revealed by dragging it left.
 *
 * The gesture is `@use-gesture/react`'s `useDrag`, axis-locked to x with `touchAction: 'pan-y'`,
 * so a vertical scroll through the list is never captured — the repo's three hand-rolled
 * touch handlers are what this exists to avoid copying.
 *
 * **Swipe is an accelerator, never the only path.** The tray's buttons are `aria-hidden` and
 * unfocusable while closed, so a screen reader is not walked through actions it cannot see; every
 * action it offers must therefore also be reachable by tapping the row itself. A row whose only
 * route to delete is a horizontal drag is not shippable on a touch-only product.
 */
export function SwipeActions({ actions, itemLabel, children, className }: Props) {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const openRef = useRef(false)
  const reduced = useReducedMotion()
  const width = trayWidth(actions.length)

  const close = () => { openRef.current = false; setOffset(0) }

  // A row that unmounts while open (deleted, filtered out by a search) must not leave its closer
  // in the registry — the next row to open would call into a dead component forever.
  useEffect(() => () => { openRows.delete(close) }, [])

  function open() {
    for (const other of openRows) if (other !== close) other()
    openRows.clear()
    openRows.add(close)
    openRef.current = true
    setOffset(-width)
  }

  const bind = useDrag(
    ({ movement: [mx], velocity: [vx], direction: [dx], first, last }) => {
      if (first) setDragging(true)
      if (!last) {
        setOffset(dragOffset(mx, openRef.current, actions.length))
        return
      }
      setDragging(false)
      if (shouldRestOpen(dragOffset(mx, openRef.current, actions.length), vx, dx, actions.length)) open()
      else { openRows.delete(close); close() }
    },
    { axis: 'x', filterTaps: true, pointer: { touch: true } },
  )

  const isOpen = offset <= -width

  return (
    <div className={cn('relative overflow-hidden', className)}>
      <div className="absolute inset-y-0 right-0 flex" aria-hidden={!isOpen}>
        {actions.map(a => (
          <button
            key={a.key}
            type="button"
            tabIndex={isOpen ? 0 : -1}
            aria-label={`${a.label} ${itemLabel}`}
            onClick={() => { openRows.delete(close); close(); a.onPress() }}
            style={{ width: ACTION_WIDTH }}
            className={cn(
              'flex flex-col items-center justify-center gap-1 text-[10px] font-semibold',
              a.destructive ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground',
            )}
          >
            {a.icon}
            {a.label}
          </button>
        ))}
      </div>
      <div
        {...bind()}
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging || reduced ? 'none' : 'transform 0.22s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          touchAction: 'pan-y',
        }}
        className="relative bg-card"
      >
        {children}
      </div>
    </div>
  )
}
