import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const code = (rel: string) =>
  read(rel)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

/**
 * BF-5 PR 2b — the week in review is a page, not a banner that expands.
 *
 * Owner: *"rather than chevron type display; id rathee its own page that you can get to from a
 * banner notifcation; or a permanent link in the health tab somewhere - the page shohld be more
 * indepth; kinda like the training calendar entry; but for the whole week. so it can visually
 * compare the week based on the metrics its talking about."*
 *
 * PR 2a shipped the engine: `/api/weekly-digest` returns `metrics` on the fresh AND cached paths.
 * This is the surface half.
 */
describe('BF-5 — the week in review page', () => {
  it('exists as its own route beside /health/day', () => {
    expect(existsSync(path.join(ROOT, 'app/health/week/page.tsx'))).toBe(true)
    expect(existsSync(path.join(ROOT, 'app/health/week/week-detail-content.tsx'))).toBe(true)
  })

  it('takes no week parameter, because the route it reads cannot honour one', () => {
    // `/api/weekly-digest` computes the recap week itself and reads nothing from the body but
    // `force`. A `?week=` would be a control that does nothing — the exact failure
    // `reminder-deep-links.test.ts` exists to catch. The plan's §6 keeps arbitrary past weeks out of
    // scope as a real query-range change of their own.
    const page = code('app/health/week/page.tsx')
    expect(page).not.toMatch(/searchParams/)
    expect(code('app/health/week/week-detail-content.tsx')).not.toMatch(/weekStart:\s*initialWeek/)
  })

  it('draws the metrics rather than re-deriving them from the prose', () => {
    // CLAUDE.md bans JSON.parse of model output; parsing numbers back out of the paragraph is the
    // same mistake, and worse here because the prompt's "quote its numbers" is a hope, not a
    // guarantee. The page reads `metrics` and nothing else.
    const content = code('app/health/week/week-detail-content.tsx')
    expect(content).toContain('data?.metrics')
    expect(content).toContain('WeekVolumeChart')
    expect(content).toContain('WeekMetricCard')
  })

  it('renders a PR from its formatted description, never from the raw 1RM', () => {
    // A bodyweight PR is BW_REF-relative and must never be announced as a weight (Q-19).
    // `describePersonalRecord` already knows that; the page must not re-derive it.
    const content = code('app/health/week/week-detail-content.tsx')
    expect(content).toContain('pr.description')
    expect(content, 'the raw number must not be rendered').not.toMatch(/\{\s*pr\.estimated1rm/)
  })

  it('states the first-week case rather than drawing it as no change', () => {
    // `volumeChangePct` is null, not 0, when there is no prior week — 0 would draw as "no change",
    // which is a different and false claim.
    expect(code('app/health/week/week-detail-content.tsx')).toContain('m.training.volumeChangePct == null')
  })

  it('reuses the month-at-a-glance rather than reproducing it', () => {
    // Q-112e built `WeekTrendsSection` for the banner. It answers a different question from this
    // page's own metrics — five WEEKLY points against the four completed weeks before them — so it
    // moves here rather than being rebuilt or dropped.
    expect(code('app/health/week/week-detail-content.tsx')).toContain('WeekTrendsSection')
  })
})

describe('BF-5 — the banner becomes the entry point', () => {
  const banner = code('components/weekly-recap-banner.tsx')

  it('navigates to the page instead of expanding into the content', () => {
    expect(banner).toContain('router.push("/health/week")')
    expect(banner, 'the expander is what the owner asked to replace').not.toContain('expandable')
    expect(banner).not.toContain('setExpanded')
  })

  it('pushes rather than using the component href, which is a document navigation', () => {
    // `DismissibleBanner`'s `href` renders a bare <a>. Inside the WebView that reloads the app and
    // throws away every mounted tab.
    expect(banner).not.toMatch(/href=/)
  })

  it('keeps the once-per-week fetch and the dismissal, which are what make it a banner', () => {
    expect(banner).toContain('hasFetched')
    expect(banner).toContain('localStorage.setItem(dismissKey')
    // `tabs-instant-paint.spec.ts` records that this POST fires on every Home mount.
    expect(banner).toContain('/api/weekly-digest')
  })

  it('and still says so when it fails, rather than vanishing', () => {
    // Q-499's class, pinned by `card-429-error-state.spec.ts`.
    expect(banner).toContain('Your week in review didn’t load')
  })

  it('drops forceOpen, whose only caller was the deep link that now lands on the page', () => {
    expect(banner).not.toContain('forceOpen')
    const home = code('app/session-select/session-select-content.tsx')
    expect(home).toContain('<WeeklyRecapBanner />')
    expect(home, 'the review=week reader goes with it').not.toMatch(/get\("review"\)/)
  })
})

describe('BF-5 — a permanent entry point that outlives the banner', () => {
  it('sits in the Health tab beside the calendar', () => {
    // The banner is dismissible and fires once a week, so a page reachable only from it is
    // unreachable for the rest of the week — and for anyone who dismissed it.
    const order = read('app/health/health-content.tsx').match(/const TRAINING_ORDER = \[([\s\S]*?)\]/)?.[1] ?? ''
    expect(order).toContain('"weekInReview"')
    expect(order.indexOf('"weekInReview"'), 'beside the calendar the owner compared it to')
      .toBeGreaterThan(order.indexOf('"calendar"'))
    expect(code('app/health/health-sections.tsx')).toContain('case "weekInReview"')
  })
})

describe('BF-5 — the stray trailing asterisk', () => {
  it('is off for a finished string, and left on for the one that streams', () => {
    // `parseIncompleteMarkdown` APPENDS a closing `*` when it counts an odd number of single
    // asterisks. That is right mid-stream and wrong for a string that is already complete, where an
    // unterminated `*` is text the model wrote — which is how a stray asterisk reached the owner.
    expect(code('app/health/week/week-detail-content.tsx')).toContain('parseIncompleteMarkdown={false}')
    // Sibling surface: the daily digest is the same finished-string case.
    expect(code('components/nutrition/end-of-day/day-digest-card.tsx')).toContain('parseIncompleteMarkdown={false}')
    // The coach transcript genuinely streams and must keep the repair.
    expect(code('components/coach/coach-message.tsx')).not.toContain('parseIncompleteMarkdown')
  })
})
