import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { AWAITING_APPROVAL_SENTENCE } from '@/lib/approval-copy'
import { stripComments } from '../../scripts/lib/strip-comments.js'

const read = (rel: string) => stripComments(readFileSync(path.join(process.cwd(), rel), 'utf8'))

describe('the awaiting-approval sentence lives in one place — LA-162', () => {
  // The bug was the two screens disagreeing, so a copy of the sentence in either file is the
  // regression, not a style problem. Comments are stripped first: this file's own prose quotes the
  // wording it forbids.
  const signIn = read('app/sign-in/email-sign-in.tsx')
  const pending = read('app/pending/page.tsx')

  it('is imported by both screens rather than written out in either', () => {
    for (const [name, src] of [['sign-in', signIn], ['pending', pending]] as const) {
      expect(src, `${name} should import the sentence`).toContain('AWAITING_APPROVAL_SENTENCE')
      expect(src, `${name} still inlines the sentence`).not.toContain(AWAITING_APPROVAL_SENTENCE)
    }
  })

  it('no longer tells a new registrant to sign in below', () => {
    // RV-192 made every password registration start inactive, so that advice lands on /pending.
    expect(signIn).not.toMatch(/Sign in below/)
  })

  it('says what is owed and roughly when, because a wait with no end reads as a failure', () => {
    expect(AWAITING_APPROVAL_SENTENCE).toMatch(/approv/i)
    expect(AWAITING_APPROVAL_SENTENCE).toMatch(/within a day/)
  })
})
