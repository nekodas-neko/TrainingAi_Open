import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../..')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

/**
 * Source with comments and imports removed.
 *
 * **Both are load-bearing and both were caught by mutation, not by reading.** A bare
 * `/NUMBER_INPUT_RESET/` matched the *import line*, so deleting the class from the element still
 * passed; and `/!text-sm/` matched the comment explaining why the bang is there. This repo has now
 * shipped that shape four times — a guard satisfied by the prose documenting its own fix.
 */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')
    .split('\n')
    .filter(l => !l.trimStart().startsWith('import '))
    .join('\n')

/**
 * BF-85 — the quantity boxes reset the spin button, and from one definition.
 *
 * Source-level because both vitest projects run `environment: 'node'`: nothing renders, so the
 * *effect* (a value that sits centred) cannot be asserted here at all — that is the device check the
 * entry asks for. What can be asserted is the thing that would silently regress: two controls for
 * one job drifting apart again, which is how `assign-step` came to be the one without the fix while
 * `quantity-editor` had carried it for months.
 */
describe('BF-85 — the number inputs share one spinner reset', () => {
  const SITES = [
    'components/nutrition/assign-step.tsx',
    'components/nutrition/quantity-editor.tsx',
  ]

  it('both quantity inputs apply the shared constant', () => {
    for (const rel of SITES) {
      expect(code(rel), `${rel} must USE the shared reset, not merely import it`)
        .toMatch(/\$\{NUMBER_INPUT_RESET\}/)
    }
  })

  it('neither hand-copies the classes the constant holds', () => {
    // The literal is what drifted. A site that pastes it again passes every behavioural test and
    // reintroduces exactly the two-copies problem this entry is about.
    for (const rel of SITES) {
      expect(code(rel), `${rel} must not re-inline the reset`).not.toMatch(/appearance:textfield/)
    }
  })

  it('the constant still names both halves — the property and the pseudo-element', () => {
    // `appearance: textfield` alone leaves the spinner in Chromium; the vendor pseudo-element is
    // the half that actually removes it. Losing either silently restores the off-centre text.
    // Read as source rather than imported: `input.tsx` carries JSX and this project is node-only.
    const src = read('components/ui/input.tsx')
    const decl = src.slice(src.indexOf('export const NUMBER_INPUT_RESET'))
    expect(decl).toContain('appearance:textfield')
    expect(decl).toContain('webkit-inner-spin-button')
  })

  it('the assign-step value beats the global 16px input rule', () => {
    // `globals.css` sets `input { font-size: 16px !important }` under 640px to stop iOS zoom, so a
    // plain `text-sm` there is silently inert and the value renders 16px beside 14px chips. The
    // bang is what makes the class win, and dropping it is invisible off-device.
    expect(code('components/nutrition/assign-step.tsx')).toMatch(/!text-sm/)
  })
})
