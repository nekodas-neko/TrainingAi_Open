import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { phraseMatches } from '@/components/ui/confirm-phrase'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

describe('phraseMatches — #2382', () => {
  it('unlocks only on the exact phrase', () => {
    expect(phraseMatches('DELETE', 'DELETE')).toBe(true)
    expect(phraseMatches('  DELETE ', 'DELETE')).toBe(true)
    expect(phraseMatches('delete', 'DELETE')).toBe(false)
    expect(phraseMatches('DELET', 'DELETE')).toBe(false)
    expect(phraseMatches('', 'DELETE')).toBe(false)
  })

  it('is always unlocked when no phrase is asked for, so existing dialogs behave as before', () => {
    expect(phraseMatches('', undefined)).toBe(true)
  })
})

describe('the ring key cannot be deleted in one tap — #2382', () => {
  // Comments stripped: these files' prose names the symbols the guards look for.
  const read = (rel: string) => stripComments(readFileSync(path.join(process.cwd(), rel), 'utf8'))
  const console_ = read('components/oura-ble/oura-ble-debug.tsx')
  const zone = read('components/oura-ble/ring-key-danger-zone.tsx')

  it('calls clearKey from exactly one place, the handler handed to the danger zone', () => {
    expect(console_.match(/\.clearKey\(/g)).toHaveLength(1)
    const handler = console_.slice(console_.indexOf('const deleteKey = useCallback'))
    expect(handler.indexOf('.clearKey(')).toBeGreaterThan(-1)
    expect(handler.indexOf('.clearKey(')).toBeLessThan(handler.indexOf('[withPlugin])'))
    expect(console_.match(/\bdeleteKey\b/g)).toHaveLength(2) // its definition and the one use
    expect(console_).toContain('<RingKeyDangerZone onDelete={deleteKey} />')
  })

  it('runs that handler only from a dialog that requires a typed phrase', () => {
    expect(zone.match(/\bonDelete\(/g)).toHaveLength(1)
    expect(zone).toMatch(/<ConfirmDialog[^>]*confirmPhrase="DELETE"[^>]*onConfirm=\{\(\) => \{[^}]*onDelete\(\)/s)
  })

  it('places the control after the log, not beside the Redecode levers', () => {
    expect(console_).not.toContain('>Clear key<')
    expect(console_.indexOf('<RingKeyDangerZone')).toBeGreaterThan(console_.indexOf('<LogConsole'))
  })
})
