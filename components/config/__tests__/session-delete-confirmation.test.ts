import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { sessionDeletePrompt, sessionLabel } from '@/components/config/session-delete-prompt'

const session = (name: string, n: number) => ({ name, exercises: Array.from({ length: n }) })

describe('sessionDeletePrompt — BF-132', () => {
  it('names the session and the number of exercises going with it', () => {
    expect(sessionDeletePrompt(session('Lower', 5))).toBe('Delete Lower and its 5 exercises?')
  })

  it('says exercise, not exercises, for one', () => {
    expect(sessionDeletePrompt(session('Push', 1))).toBe('Delete Push and its 1 exercise?')
  })

  it('drops the clause entirely when there is nothing in the session', () => {
    expect(sessionDeletePrompt(session('Pull', 0))).toBe('Delete Pull?')
  })

  it('falls back for a session added but not yet named', () => {
    // The name field ships empty and its placeholder is a hint, not a value, so the prompt has to
    // survive a blank one rather than reading "Delete  and its 2 exercises?".
    expect(sessionLabel({ name: '   ' })).toBe('Untitled session')
    expect(sessionDeletePrompt(session('', 2))).toBe('Delete Untitled session and its 2 exercises?')
  })
})

describe('the trash icon cannot delete a session on its own — BF-132', () => {
  // Comments are stripped from both files before every assertion below: this file's own prose names
  // the symbols it forbids, and a guard that matches its own explanation fails for the wrong reason.
  // No proximity window and no exact-marker anchor either — both have broken a guard in this repo
  // without the guarded behaviour changing.
  const read = (rel: string) =>
    readFileSync(path.join(process.cwd(), rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')

  const sheet = read('components/config/program-editor-sheet.tsx')
  const header = read('components/config/session-header-row.tsx')

  it('has no tap handler anywhere that deletes a session directly', () => {
    // What shipped the bug: onClick={() => { removeSession(si); … }} on the trash button, one array
    // filter away from losing a session and its whole exercise list with no way back.
    for (const src of [sheet, header]) expect(src).not.toMatch(/onClick=\{[^}]*removeSession\(/)
    expect(header).not.toContain('removeSession')
  })

  it('routes the tap through a confirmation instead', () => {
    expect(header).toMatch(/onClick=\{onRequestDelete\}/)
    expect(sheet).toMatch(/onRequestDelete=\{[^}]*setPendingSessionDelete\(/)
    expect(sheet).toContain('ConfirmDialog')
    expect(sheet).toMatch(/onConfirm=\{[\s\S]{0,200}removeSession\(/)
  })

  it('offers an undo, because confirming the wrong thing is still possible', () => {
    expect(sheet).toMatch(/onClick=\{undoRemoveSession\}/)
  })

  it('keeps the undo inside the sheet, where it can actually be tapped', () => {
    // A sonner toast paints above the sheet (z-index 999999999 against z-50) and is still dead to
    // touch: Radix makes SheetContent modal, so its subtree intercepts the pointer events and
    // everything portalled outside it stops receiving them. Found in a browser, invisible to
    // typecheck, lint and the unit suite alike.
    expect(sheet).not.toContain('sonner')
  })
})
