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
  /**
   * The row's own surface, which must be OPAQUE — the tray sits behind it, and a translucent row
   * shows the Delete button through its own text. `bg-card` suits a list whose container paints
   * nothing; a row inside an already-tinted card passes that card's colour instead, or it reads as
   * a darker band between the header and the totals.
   */
  surfaceClassName?: string
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
export function SwipeActions({ actions, itemLabel, children, className, surfaceClassName = 'bg-card' }: Props) {
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

  // **Any displacement at all, not the resting-open state (BF-61, sweep 3).** The tray becomes visible
  // the moment the row starts moving, so from that moment it is what a tap over its rect is aimed at.
  // The `offset <= -width` this replaced was true only once the row had travelled the FULL tray width.
  const displaced = offset < 0

  return (
    // `data-swipe-actions` marks the row as owning horizontal gestures that start on it, the way
    // `data-swipe-carousel` already marks a carousel. A screen with its own horizontal drag — the
    // nutrition tab changes the DAY on one — otherwise runs both from the same touch, and a thumb
    // opening a tray also moves the list out from under itself.
    <div data-swipe-actions className={cn('relative overflow-hidden', className)}>
      {/*
        `z-10` whenever the row is DISPLACED is what makes the FIRST tap land on Delete (BF-61). The
        row is a later sibling, so it paints above the tray, and hit-testing follows the *animated*
        transform — while the row is over the tray a tap there hits the row, which swallows it. The
        owner reported needing two presses and confirmed the cause by waiting a second.

        **⚠ Gating this on `isOpen` was not enough, and the device said so twice.** `isOpen` is
        `offset <= -width`, which is only true once the row has travelled the FULL tray width — so
        the raise arrived at the end of the journey rather than the start of it, and everything
        before that was still the old bug. Sweep 3 tapped in the same `adb shell` call as the swipe,
        so the tap landed before React had committed the rest-open state at all: **no confirmation,
        2 of 2**, while the slow tap worked 3 of 3. `offset < 0` raises the tray for the whole of the
        window in which it is visible, which is the invariant that actually matters — *if you can see
        it, you can hit it.* Shortening the animation would only have made the window rarer.

        `aria-hidden` and `tabIndex` follow the same flag rather than `isOpen`: a visible button that
        is `aria-hidden` yet clickable is the shape a11y tooling flags, and the tray is genuinely
        exposed from the moment it can be seen. Closed (`offset === 0`) it is hidden and unfocusable,
        which is what the component's own doc comment promises a screen reader.
      */}
      <div className={cn('absolute inset-y-0 right-0 flex', displaced && 'z-10')} aria-hidden={!displaced}>
        {actions.map(a => (
          <button
            key={a.key}
            type="button"
            tabIndex={displaced ? 0 : -1}
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
        className={cn('relative', surfaceClassName)}
      >
        {children}
      </div>
    </div>
  )
}
