import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { formatBuildDate } from '@/components/more/build-label'

/**
 * BF-111 — "Up to date — v1.414.1 is the newest build" under a v1.436.2 badge, both correct.
 *
 * The web app advances on every Railway deploy; the APK only changes on a rebuild, and the two
 * legitimately diverge because the APK is a WebView loading Railway. Nothing on screen said so, so
 * a green tick appeared to vouch for the smaller number.
 */

const ROOT = path.resolve(__dirname, '..', '..')
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const stripped = (rel: string) => src(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('the build date', () => {
  it('renders in the user timezone, not the device one', () => {
    // 2026-08-31T15:30Z is already 1 Sep in Brisbane. A device-local format would read Aug 31 for a
    // user in London and Sep 1 for the same user's data in Brisbane — the repo's recurring date bug.
    // en-AU ordering, which is what `formatDayShort` already renders everywhere else in the app.
    expect(formatBuildDate('2026-08-31T15:30:00Z', 'Australia/Brisbane')).toBe('1 Sept')
    expect(formatBuildDate('2026-08-31T15:30:00Z', 'Europe/London')).toBe('31 Aug')
  })

  it('formats an ordinary timestamp as a short day', () => {
    expect(formatBuildDate('2026-08-31T02:00:00Z', 'Australia/Brisbane')).toBe('31 Aug')
  })

  it('returns null rather than a broken label when there is no date', () => {
    // `nativeBuiltAt` is null whenever the release lookup fails, which is the same path that makes
    // the card say "could not check" — it must not render "built Invalid Date".
    expect(formatBuildDate(null, 'Australia/Brisbane')).toBeNull()
    expect(formatBuildDate(undefined, 'Australia/Brisbane')).toBeNull()
    expect(formatBuildDate('not-a-date', 'Australia/Brisbane')).toBeNull()
    expect(formatBuildDate('', 'Australia/Brisbane')).toBeNull()
  })
})

describe('the card names what each number governs', () => {
  const card = () => stripped('components/more/update-check-card.tsx')

  it('calls the section the Android build, not the app build', () => {
    // "App build" is what made the tick read as a claim about the version in the badge above it.
    const s = card()
    expect(s).toContain('Android build')
    expect(s).not.toMatch(/>\s*App build\s*</)
  })

  it('names the INSTALLED version in every state, which is what answers "do I have that fix?"', () => {
    // Pinned per branch: the up-to-date line, the update line and the could-not-check line each
    // have to carry it, and asserting the string once would pass with two of the three missing.
    const s = card()
    expect(s).toMatch(/Up to date — v\{state\.installedVersion\}/)
    expect(s).toMatch(/You have v\{state\.installedVersion\} — tap to download/)
    expect(s).toMatch(/Could not check for a newer build — you have v\{state\.installedVersion\}/)
  })

  it('shows the date beside the version, and omits it cleanly when absent', () => {
    // Condition and consequent in one pattern — a split assertion passes against a disabled branch.
    expect(card()).toMatch(/built \$\{built\}` : ""\}/)
    expect(card()).toMatch(/\$\{built\}\)` : ""\}/)
  })

  it('keeps the unknown state from claiming either way', () => {
    // "Could not check" is not "up to date" — a false all-clear is the same class of mistake as a
    // false alarm, and the three-state shape is what the original card was built around.
    const s = card()
    expect(s).toMatch(/kind: "unknown"; installedVersion: string/)
    expect(s).toMatch(/Could not check for a newer build/)
  })
})

describe('the About panel', () => {
  it('labels its chip as the app version rather than a bare number', () => {
    expect(stripped('components/more/about-panel.tsx')).toMatch(/App v\{CURRENT_VERSION\}/)
  })

  it('says the app updates itself, which is why the two numbers differ', () => {
    expect(stripped('components/more/about-panel.tsx')).toContain('Updates automatically')
  })
})
