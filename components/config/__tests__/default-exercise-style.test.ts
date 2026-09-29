import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { defaultStyleIdForSlot } from '@/components/config/default-exercise-style'
import { stripComments } from '../../../scripts/lib/strip-comments.js'
import type { ProgressionStyle } from '@trainingai/shared/types'

const style = (id: string, name: string): ProgressionStyle =>
  ({ id, name, isDefault: false, sets: [] }) as unknown as ProgressionStyle

const power = style('power', 'Powerbuilding')
const hyper = style('hyper', 'Hypertrophy 3-set')
const general = style('general', 'General')
const styles = [general, hyper, power]

const session = (...exercises: { styleId?: string; exerciseRole?: 'primary' | 'secondary' | 'accessory' }[]) =>
  ({ exercises })

describe('defaultStyleIdForSlot — LB-186', () => {
  it('takes the style the role already uses, not the program-wide favourite', () => {
    // The shape this exists for: accessories outnumber primaries, so the program-wide answer is an
    // accessory style and would be wrong for a slot the user has just marked primary.
    const program = [
      session(
        { styleId: 'hyper', exerciseRole: 'accessory' },
        { styleId: 'hyper', exerciseRole: 'accessory' },
        { styleId: 'general', exerciseRole: 'accessory' },
        { styleId: 'power', exerciseRole: 'primary' },
      ),
    ]
    expect(defaultStyleIdForSlot(program, styles, 'primary')).toBe('power')
    expect(defaultStyleIdForSlot(program, styles, 'accessory')).toBe('hyper')
  })

  it('falls back to the program-wide favourite when the role has no styled slot yet', () => {
    const program = [session({ styleId: 'hyper', exerciseRole: 'accessory' }, { styleId: 'hyper', exerciseRole: 'accessory' }, { styleId: 'general', exerciseRole: 'accessory' })]
    expect(defaultStyleIdForSlot(program, styles, 'primary')).toBe('hyper')
  })

  it('answers without a role at all, which is what a newly-added slot has', () => {
    const program = [session({ styleId: 'general' }), session({ styleId: 'general' }, { styleId: 'power' })]
    expect(defaultStyleIdForSlot(program, styles)).toBe('general')
  })

  it('never returns a style the user has since deleted', () => {
    // The editor already flags an unresolvable styleId ("Style … not found — please reassign"), so
    // handing a new slot that same dead id would spread the amber row rather than fill a gap.
    const program = [session({ styleId: 'deleted-style', exerciseRole: 'accessory' })]
    expect(defaultStyleIdForSlot(program, styles, 'accessory')).toBe('general')
  })

  it('still answers for a program with nothing styled yet, because a null is the bug', () => {
    expect(defaultStyleIdForSlot([session({}, {})], styles)).toBe('general')
    expect(defaultStyleIdForSlot([], styles)).toBe('general')
  })

  it('returns undefined only when the user has no styles to choose from', () => {
    expect(defaultStyleIdForSlot([session({})], [])).toBeUndefined()
  })

  it('breaks a tie the same way every time', () => {
    const program = [session({ styleId: 'power' }, { styleId: 'hyper' })]
    expect(defaultStyleIdForSlot(program, styles)).toBe('power')
    expect(defaultStyleIdForSlot(program, styles)).toBe('power')
  })
})

describe('the editor never adds a styleless slot — LB-186', () => {
  // Comments are stripped first: this file's prose names the literal it forbids.
  const sheet = stripComments(
    readFileSync(path.join(process.cwd(), 'components/config/program-editor-sheet.tsx'), 'utf8'),
  )

  it('fills the style at the point the slot is created', () => {
    expect(sheet).toMatch(/addExercise[\s\S]{0,400}defaultStyleIdForSlot\(programSessions, styles\)/)
    expect(sheet).not.toMatch(/exercises: \[\.\.\.s\.exercises, \{ key: nextEditKey\(\), name: "" \}\]/)
  })

  it('fills a styleless slot when its role is set, and leaves a chosen style alone', () => {
    expect(sheet).toMatch(/e\.styleId \? e : \{ \.\.\.e, styleId: defaultStyleIdForSlot\(programSessions, styles, role\) \}/)
  })
})
