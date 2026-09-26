import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stripComments } from '../../../scripts/lib/strip-comments.js'
import { moveSection } from '../section-order'

/**
 * BF-205 — the owner: *"when I click the grid button on the home screen I cannot move widgets and
 * re-arrange them."* Every part of the feature existed except the gesture, so this is the piece
 * that was missing, and the cases below are the ones the rendered list can spring on it.
 */
const ORDER = ['recommendation', 'streak', 'weekStrip', 'card_sleepWidget', 'metricTiles'] as const
type Key = (typeof ORDER)[number]
const order = [...ORDER] as Key[]

describe('moveSection', () => {
  it('moves a section down to the dropped-on position', () => {
    expect(moveSection(order, 'recommendation', 'weekStrip'))
      .toEqual(['streak', 'weekStrip', 'recommendation', 'card_sleepWidget', 'metricTiles'])
  })

  it('moves a section up', () => {
    expect(moveSection(order, 'metricTiles', 'streak'))
      .toEqual(['recommendation', 'metricTiles', 'streak', 'weekStrip', 'card_sleepWidget'])
  })

  it('keeps every key, so nothing can be dropped out of the list', () => {
    for (const to of ORDER) {
      expect([...moveSection(order, 'weekStrip', to)].sort()).toEqual([...ORDER].sort())
    }
  })

  it('is a no-op on itself', () => {
    expect(moveSection(order, 'streak', 'streak')).toEqual(order)
  })

  it('is a no-op when a key is unknown — a drop can race the widget reconciliation', () => {
    // Toggling a card widget in More rewrites this list. A drop that lands either side of that
    // must do nothing rather than splice against an index that no longer means what it did.
    expect(moveSection(order, 'card_moodWidget' as Key, 'streak')).toEqual(order)
    expect(moveSection(order, 'streak', 'card_moodWidget' as Key)).toEqual(order)
  })

  it('addresses by KEY, so hidden sections between the two do not shift the result', () => {
    // The rendered list is a filtered subset; dropping onto the third visible card must not move
    // the third stored key. This is the case an index-based move gets wrong.
    const withHidden = ['a', 'hidden1', 'b', 'hidden2', 'c'] as const
    expect(moveSection([...withHidden], 'c', 'a')).toEqual(['c', 'a', 'hidden1', 'b', 'hidden2'])
  })

  it('does not mutate its input', () => {
    const input = [...ORDER] as Key[]
    moveSection(input, 'recommendation', 'metricTiles')
    expect(input).toEqual([...ORDER])
  })
})

/**
 * The wiring, guarded at source — because the defect BF-205 records is precisely a feature whose
 * every part existed except one, and read as finished from every angle but the gesture.
 */
describe('BF-205 — the reorder is actually wired up', () => {
  const src = (p: string) =>
    stripComments(readFileSync(join(__dirname, '..', '..', '..', p), 'utf8')) as string

  it('the section is a dnd-kit sortable, dragged by a handle', () => {
    const section = src('components/home-sortable-section.tsx')
    expect(section, 'HomeSortableSection is named Sortable and does not sort — the BF-205 defect')
      .toMatch(/useSortable\(/)
    expect(section, 'the drag must be on a handle, or a vertical scroll picks a card up')
      .toMatch(/ref=\{handleRef\}/)
  })

  it('the handle sets touch-action: none', () => {
    // Without it the browser claims the gesture for the scroll before PointerSensor sees it, and
    // the drag silently never starts — on the device only, which no sandbox run would catch.
    const section = src('components/home-sortable-section.tsx')
    const handle = /ref=\{handleRef\}[\s\S]*?className="([^"]*)"/.exec(section)
    expect(handle, 'no className found on the drag handle').not.toBeNull()
    expect(handle![1]).toMatch(/\btouch-none\b/)
  })

  it('Home mounts a DragDropProvider wired to the drag hook', () => {
    const home = src('app/session-select/session-select-content.tsx')
    expect(home).toMatch(/<DragDropProvider[^>]*onDragOver=\{sectionDrag\.onDragOver\}/)
    expect(home, 'a reorder that is not persisted is lost on the next visit')
      .toMatch(/onDragEnd=\{sectionDrag\.onDragEnd\}/)
  })

  it('the hook reorders by key and persists only on drag END', () => {
    const hook = src('lib/hooks/use-home-section-drag.ts')
    expect(hook, 'the reorder must go through moveSection — the rendered list is a subset')
      .toMatch(/moveSection\(orderRef\.current/)
    // `savePreference` PATCHes the server as well as writing localStorage, so it belongs on the
    // drag END. Saving per `dragover` puts a request behind every position the thumb passes.
    const over = /const onDragOver = useCallback\([\s\S]*?\n  \}, \[/.exec(hook)
    expect(over, 'onDragOver not found').not.toBeNull()
    expect(over![0], 'the per-event handler must not persist').not.toMatch(/savePreference/)
    expect(hook).toMatch(/const onDragEnd = useCallback\([\s\S]*?savePreference\('homeSectionOrder'/)
  })
})
