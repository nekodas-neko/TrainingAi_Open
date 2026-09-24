import { describe, it, expect } from 'vitest'
import { mustBypassImageOptimizer, PRIVATE_MEDIA_PREFIX } from '../private-media'

// DV-18. `/exercise-media/*` sits behind the session gate, and Next's image optimizer fetches a
// source server-side with no cookie — so it is redirected to `/sign-in`, gets HTML, and answers
// 400. Measured against `pnpm dev` on 2026-09-24: the direct request is a 307 to `/sign-in`, and
// `/_next/image?url=%2Fexercise-media%2F…` is a 400, "The requested resource isn't a valid image".
describe('mustBypassImageOptimizer', () => {
  it('bypasses every private media URL, whatever the extension', () => {
    // The broken case was specifically a NON-gif: the old per-site check was `endsWith('.gif')`,
    // so a `.png` under this prefix went to the optimizer and failed.
    for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif']) {
      const src = `${PRIVATE_MEDIA_PREFIX}reference-figure.${ext}`
      expect(mustBypassImageOptimizer(src), src).toBe(true)
    }
  })

  it('still bypasses a GIF from anywhere — the optimizer serves a still frame', () => {
    expect(mustBypassImageOptimizer('https://raw.githubusercontent.com/x/y/squat.gif')).toBe(true)
  })

  it('leaves a public, optimizable image alone', () => {
    // Avatars and the public exercise dataset are fetchable without a session, so the optimizer
    // reaches them and is worth using. Bypassing everything would be a silent deoptimisation.
    expect(mustBypassImageOptimizer('https://lh3.googleusercontent.com/a/abc123')).toBe(false)
    expect(mustBypassImageOptimizer('https://raw.githubusercontent.com/x/y/squat.png')).toBe(false)
  })

  it('does not match a path that merely contains the prefix later on', () => {
    expect(mustBypassImageOptimizer('https://cdn.example.com/exercise-media/x.png')).toBe(false)
  })
})
