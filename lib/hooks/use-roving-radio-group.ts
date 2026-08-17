'use client'

import { useCallback, type KeyboardEvent } from 'react'

/**
 * Arrow-key navigation and a roving tabindex for a `role="radiogroup"` — Q-350.
 *
 * The app had eight hand-rolled radiogroups and none of them implemented this, so `Tab` walked
 * every option individually and the arrow keys did nothing. The ARIA authoring practices expect a
 * radiogroup to be **one** tab stop, with the arrows moving (and selecting) within it.
 *
 * **A hook rather than a `components/ui/` radio-group component, which is what Q-350 proposed.**
 * The eight call sites render five genuinely different things — two-line segmented pills, a
 * bordered card list with descriptions, a compact kg/lbs toggle, a four-way region strip, a card
 * list with a check icon. A single component covering all of them needs either a render-prop for
 * the option body or enough styling props to reconstruct each one, and that abstraction fits none
 * of them well. What every site is missing is *behaviour*, and behaviour is what this shares. The
 * markup stays where it is and stays readable.
 *
 * **Selection is delegated by clicking the target**, not by calling back with a value. Each site
 * already owns its own selection semantics — some toggle off when you re-pick the active option,
 * some cannot be cleared — and routing the keyboard through the same `onClick` those buttons
 * already have means this hook cannot get any of that subtly wrong. Arrow keys never land on the
 * already-active option, so the deselect-on-repick sites are unaffected.
 *
 * Usage:
 * ```tsx
 * const { groupProps, getRadioProps } = useRovingRadioGroup(value != null)
 * <div {...groupProps} aria-labelledby="…">
 *   {options.map((o, i) => (
 *     <button {...getRadioProps(o === value, i)} onClick={…}>…</button>
 *   ))}
 * </div>
 * ```
 */
export function useRovingRadioGroup(hasSelection: boolean) {
  const onKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown'
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
    if (!forward && !back) return

    // Read the options from the DOM rather than from a list passed in: it keeps the hook agnostic
    // about how each site renders, and it can never disagree with what is actually on screen.
    const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')]
      .filter(el => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true')
    if (radios.length === 0) return

    const current = radios.indexOf(document.activeElement as HTMLElement)
    if (current === -1) return

    e.preventDefault()
    const next = radios[(current + (forward ? 1 : -1) + radios.length) % radios.length]
    next.focus()
    // Selecting on arrow is the ARIA behaviour for a radiogroup, and going through click reuses the
    // site's own handler rather than reimplementing its semantics here.
    next.click()
  }, [])

  const getRadioProps = useCallback(
    (checked: boolean, index: number) => ({
      role: 'radio' as const,
      'aria-checked': checked,
      // Exactly one option is in the tab order. With nothing selected — several of these groups
      // clear when you re-pick the active option — that is the first, so the group stays reachable.
      tabIndex: checked || (!hasSelection && index === 0) ? 0 : -1,
    }),
    [hasSelection],
  )

  return {
    groupProps: { role: 'radiogroup' as const, onKeyDown },
    getRadioProps,
  }
}
