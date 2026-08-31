import { join } from 'node:path'
import { expect, type Locator, type Page } from '@playwright/test'

/** Seeded by `scripts/local-db/seed.sql`. Idempotent — `pnpm db:local` will not re-seed. */
export const SEED_EMAIL = 'test@local.dev'
export const SEED_PASSWORD = 'testpass123'

export const STORAGE_STATE = join(__dirname, '.auth', 'seed-user.json')

/**
 * A second account with no program, no logs and no metrics (Q-352).
 *
 * Every other spec runs as the seeded user, who has all three — so before this existed **no
 * first-run or empty state was reachable from the harness at all**, which is exactly where the
 * 2026-08-17 failure-cells sweep found the app broken (Q-451's dead primary action on the primary
 * tab, Q-452's AI copy). Both shipped verified-by-hand and unguarded for want of it.
 *
 * **Created by `zero-data.setup.ts` rather than by `scripts/local-db/seed.sql`, deliberately.**
 * `setup.sh` skips the seed entirely when `users` is non-empty, so a developer's existing local
 * database would never gain the account while CI (fresh every run) always would — a spec that
 * assumed it would pass in CI and fail locally, which is the wrong way round for a regression
 * guard. Creating it from the setup project makes local and CI identical.
 *
 * Use it per-file: `test.use({ storageState: ZERO_DATA_STORAGE_STATE })`.
 */
export const ZERO_DATA_EMAIL = 'zero@local.dev'
export const ZERO_DATA_STORAGE_STATE = join(__dirname, '.auth', 'zero-data-user.json')

/**
 * Visit a route twice and return only after the second visit has painted.
 *
 * The first visit fills the caches; the second is the one the instant-paint rule is about — a
 * screen that shows a skeleton on a *repeat* visit is a bug (CLAUDE.md, "Instant paint"). Specs
 * assert on what is on screen right after this resolves, before any network settles.
 */
export async function visitTwice(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  await page.goto(path)
  await page.waitForLoadState('domcontentloaded')
  await settleRouteBoundary(page)
}

/**
 * Wait for the tab route's `loading.tsx` boundary (`components/shell/tab-loading.tsx`) to hand over
 * to the real screen. It marks itself `aria-busy`, which is the honest signal to wait on.
 *
 * This matters more here than in production: the harness drives `pnpm dev`, so the first navigation
 * to a route pays a compile and the boundary is visible for seconds rather than "one network round
 * trip at most". Asserting through it would make every spec a race against the dev compiler.
 */
export async function settleRouteBoundary(page: Page): Promise<void> {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 60_000 })
}

/**
 * Assert a screen painted real content rather than a loading state.
 *
 * Deliberately not a screenshot comparison: a pixel baseline would have to be regenerated on every
 * unrelated style change and would rot into an ignored red. This checks the property the rule
 * actually states — that something other than a skeleton is on screen.
 */
export async function expectNoSkeleton(page: Page, timeout = SKELETON_TIMEOUT_MS): Promise<void> {
  // Counted in the viewport, not across the document. Health renders all three of its tabs at once
  // inside a SwipeCarousel, so the inactive panels are mounted and — to Playwright — "visible",
  // while the user cannot see them. A document-wide check reports those off-screen panels' loading
  // cards as instant-paint violations on whatever tab happens to be open. They are not: an inactive
  // tab's data is fetched when you swipe to it, by design (health-content.tsx's per-tab groups).
  await expect
    .poll(async () => page.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight
      return [...document.querySelectorAll('.animate-pulse')].filter(el => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw
      }).length
    }), { timeout, message: 'skeletons still visible in the viewport on a repeat visit' })
    .toBe(0)
  await expect(page.getByText(/^Loading…?$/).first()).toBeHidden({ timeout })
}

/**
 * Deliberately generous, and the reason is a limitation worth knowing rather than a fudge.
 *
 * The harness drives `pnpm dev`, so a route's API handlers compile on their first call. A screen
 * like Health fires six fetches behind a concurrency cap, and the last one in that queue can take
 * many seconds on a cold compile — which is indistinguishable, from the outside, from a card that
 * genuinely failed to seed. A short budget turns that into a phantom instant-paint violation.
 *
 * The cost is real: this cannot catch a card that seeds *slowly but correctly*. It can still catch
 * a card that never seeds at all, which is the failure this rule is actually about.
 */
export const SKELETON_TIMEOUT_MS = 20_000

/**
 * Give the seeded user everything `computeEnergyBalance` needs before it will return a number.
 *
 * The route answers `balance: null` plus `missingProfileFields` until it has weight, height, date of
 * birth and sex (`lib/health/energy-balance-service.ts:161-167`). The seeded user has three of the
 * four — **only `date_of_birth` is missing** — so every Home card that renders an energy figure
 * shows "Add your date of birth in Profile" instead of a value, and a spec that drives one is
 * testing the empty state without meaning to. Q-402's fix could not be driven end to end for
 * exactly this reason: three probes measured zero `/api/nutrition/energy-balance` requests.
 *
 * Written here rather than in `scripts/local-db/seed.sql` for the same reason as the zero-data
 * account: `setup.sh` skips the seed on a non-empty `users` table, so an existing local database
 * would never gain the column while CI always would.
 *
 * Returns the user's id, which callers need to scope their own fixture rows.
 */
export async function ensureEnergyBalanceProfile(email = SEED_EMAIL): Promise<string> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const { Client } = await import('pg')
  const db = new Client({ connectionString })
  await db.connect()
  try {
    // A fixed date, not an offset from today: an age that changes between runs changes the BMR and
    // with it every number this fixture underpins.
    const { rows } = await db.query<{ id: string }>(
      `UPDATE users SET date_of_birth = COALESCE(date_of_birth, DATE '1995-06-15'),
                        height_cm     = COALESCE(height_cm, 180),
                        sex           = COALESCE(sex, 'male')
        WHERE email = $1
       RETURNING id`,
      [email],
    )
    const id = rows[0]?.id
    expect(id, `${email} is not seeded — run pnpm db:local`).toBeTruthy()
    return id
  } finally {
    await db.end()
  }
}

/**
 * Guarantee the seeded user has a `body_metrics` steps value for **their** today, and hand back a
 * restore function.
 *
 * **Why a spec cannot assume the seed provides this (LB-19, corrected 2026-08-30).** `seed.sql`
 * writes fourteen days ending at `today - 0`, but *its* today is the day the seed **ran** — and
 * `setup.sh` skips seeding a non-empty `users` table, so nothing back-fills. A container two days
 * old therefore has no row for the current day, `goals-progress-card.tsx` filters `visibleRows` on
 * `value != null`, and the steps row simply does not render. Measured: a five-day-old database put
 * `max(date) WHERE steps IS NOT NULL` at `2026-08-25` against a `current_date` of `2026-08-30`, and
 * `goal-invalidation.spec.ts` failed with the goal locator *not found* rather than on time. CI
 * provisions a fresh database per run, which is why this is invisible there.
 *
 * **The date is the USER's, not the runner's** — the same rule `suppressMorningCheckin` follows.
 * The screens read `todayInTz(session.user.timezone)`, and the container's zone is not the seeded
 * user's.
 *
 * `8000` matches what the seed itself writes for `d = 0` (`seed.sql:104`), so a spec asserting
 * against it reads the same on a fresh database and an aged one.
 *
 * Non-destructive: an existing steps value is left alone, and `restore()` puts back exactly what was
 * there — including a row that did not exist.
 */
export async function ensureStepsToday(
  steps = 8000,
  email = SEED_EMAIL,
): Promise<{ userId: string; date: string; restore: () => Promise<void> }> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const { Client } = await import('pg')
  const db = new Client({ connectionString })
  await db.connect()
  try {
    const { rows: userRows } = await db.query<{ id: string; d: string }>(
      `SELECT id, to_char(now() AT TIME ZONE coalesce(timezone, 'Australia/Brisbane'), 'YYYY-MM-DD') AS d
         FROM users WHERE email = $1`,
      [email],
    )
    const userId = userRows[0]?.id
    const date = userRows[0]?.d
    expect(userId, `${email} is not seeded — run pnpm db:local`).toBeTruthy()

    const { rows: existing } = await db.query<{ steps: number | null }>(
      'SELECT steps FROM body_metrics WHERE user_id = $1 AND date = $2',
      [userId, date],
    )

    if (existing.length > 0 && existing[0].steps != null) {
      return { userId, date, restore: async () => {} }
    }

    if (existing.length === 0) {
      await db.query(
        'INSERT INTO body_metrics (user_id, date, steps) VALUES ($1, $2, $3)',
        [userId, date, steps],
      )
      return {
        userId,
        date,
        restore: async () => {
          const c = new Client({ connectionString })
          await c.connect()
          try { await c.query('DELETE FROM body_metrics WHERE user_id = $1 AND date = $2', [userId, date]) }
          finally { await c.end() }
        },
      }
    }

    await db.query('UPDATE body_metrics SET steps = $3 WHERE user_id = $1 AND date = $2', [userId, date, steps])
    return {
      userId,
      date,
      restore: async () => {
        const c = new Client({ connectionString })
        await c.connect()
        try { await c.query('UPDATE body_metrics SET steps = NULL WHERE user_id = $1 AND date = $2', [userId, date]) }
        finally { await c.end() }
      },
    }
  } finally {
    await db.end()
  }
}

/**
 * Turn Home's card widgets on for this page.
 *
 * `DEFAULT_CARD_WIDGETS` is empty (`lib/home/home-prefs.ts:104`), so a fresh browser profile renders
 * **no card widgets at all** — the second half of why Q-402's fix was unguarded. The preference is
 * plain localStorage, so an init script sets it without driving the More → Home Widgets UI, which
 * would couple every Home-card spec to an unrelated screen.
 *
 * Call before `page.goto`.
 */
export async function enableHomeCards(page: Page, keys: string[]): Promise<void> {
  await page.addInitScript(
    ([storageKey, value]) => localStorage.setItem(storageKey, value),
    ['ta_ss_cards', JSON.stringify(keys)] as const,
  )
}

/**
 * Open a saved meal from the library, landing on its own screen (BF-30).
 *
 * The row used to expand in place; it now opens `meal-detail-sheet.tsx` stacked over the list,
 * which is where `Log this meal`, `Edit …`, `Print a label for …` and `Delete …` live. Specs that
 * reach for any of those open the meal first. Idempotent — a meal already open is left alone.
 *
 * Matching is anchored to the START of the row's accessible name (the meal name, then its grey line
 * and calorie figure). Unanchored, it would also match `Edit <meal>` and the swipe tray's buttons,
 * and the locator would go strict-mode ambiguous exactly when it had succeeded.
 */
export async function openSavedMeal(page: Page, mealName: string): Promise<void> {
  const opened = page.getByRole('button', { name: 'Log this meal' })
  if (await opened.count() > 0) return
  const escaped = mealName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const row = page.getByRole('button', { name: new RegExp(`^${escaped}`) }).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  // **Re-measure inside the retry — one measure and one tap is a race here.** Since Q-395c this list
  // merges foods in asynchronously and re-sorts, and a meal that has a photo grows a tile whose
  // image decodes later still, so the row can move between `boundingBox()` and the tap and the
  // finger lands on whatever slid into that position. It cost a CI run: the FIRST photo-picker test
  // passed and the second — the one running against a meal test 1 had just given a photo — failed on
  // both attempts. The `count()` guard is what stops a retry re-tapping through an open sheet's
  // overlay and dismissing it.
  await expect(async () => {
    if (await opened.count() === 0) {
      const box = (await row.boundingBox())!
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    }
    await expect(opened).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  // **`toBeVisible()` is true the instant the sheet mounts, which is 500 ms before it arrives.**
  // `SheetContent` slides in over `duration-500`, so a caller that measures a `boundingBox()` right
  // after this gets a position the element is still travelling through — measured at y=1127 on a
  // 915 px viewport, where `elementFromPoint` returns nothing and a coordinate tap silently hits
  // the void. `toBeInViewport` is the assertion that waits for the animation rather than the mount.
  await expect(opened).toBeInViewport()
}

/**
 * Drag a list row to the left, far enough that its `SwipeActions` tray rests open.
 *
 * Playwright's `touchscreen` can tap and nothing else, and a mouse drag proves nothing about a
 * handler bound with `pointer: { touch: true }` — so the moves go through CDP directly. They are
 * spaced in time on purpose: `@use-gesture` derives velocity from the interval, and a burst
 * dispatched in one tick reads as an instant flick rather than a drag.
 *
 * **Measure only once the row has stopped moving, and that is the whole reason this is shared.**
 * `Input.dispatchTouchEvent` performs none of the actionability checks `locator.tap()` does — in
 * particular not the stability one — so a coordinate read while the sheet behind the row is still
 * running its `enter` animation is a coordinate the row has already left. Measured 2026-08-31 with
 * the row's rect sampled every frame: `toBeVisible()` passed, `boundingBox()` returned y=605, and
 * by the time the touch landed the row sat at y=503 — 100 px higher — so every point in the gesture
 * hit the sheet's scroll container beneath it and the drag handler was **never invoked once**. The
 * failure that produces is `Delete <item>` never appearing, which reads as a broken gesture rather
 * than a mis-aimed one, and it cost a whole implementation of BF-39 (held for a week as a
 * render-vs-remount question it never was). `toBeInViewport()` does not catch it: it is satisfied
 * the moment a pixel of the sheet crosses the fold, ~400 ms before it settles.
 */
export async function swipeRowLeft(page: Page, row: Locator, options: SwipeRowOptions = {}): Promise<void> {
  const { distance = 200, steps = 10, centreFirst = false, releaseWithPoint = false } = options
  await expect(row).toBeVisible()
  if (centreFirst) await row.evaluate(el => el.scrollIntoView({ block: 'center' }))
  const box = await stableBox(row)
  const y = box.y + box.height / 2
  const startX = box.x + box.width - 16
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y }] })
    for (let step = 1; step <= steps; step++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: startX - (distance * step) / steps, y }],
      })
      await page.waitForTimeout(16)
    }
    // Some callers need the final point still in `changedTouches` — the nutrition tab's day-swipe
    // reads `changedTouches[0]` on touchend, so an empty release skips the very gesture a spec
    // asserting the two do not collide exists to provoke.
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: releaseWithPoint ? [{ x: startX - distance, y }] : [],
    })
  } finally {
    await cdp.detach()
  }
}

export interface SwipeRowOptions {
  /** How far left to drag, in CSS pixels. Past half the tray's width the row rests open. */
  distance?: number
  /**
   * Scroll the row to the middle of the viewport first. A diary row's natural position can be under
   * the bottom tab bar, where every touch point lands on a nav icon instead.
   */
  centreFirst?: boolean
  /** Release with the final touch point still in `changedTouches` — see the touchEnd note above. */
  releaseWithPoint?: boolean
  /**
   * How many moves the drag is split into. Fewer, over the same 16 ms spacing, means a faster
   * gesture: `@use-gesture` derives velocity from the interval, and past `FLICK_VELOCITY` a drag
   * commits open on direction alone rather than on distance. A short flick is the only way to
   * leave the row **short** of its resting offset, which is the state BF-61 is about.
   */
  steps?: number
}

/**
 * An element's box once two reads a frame apart agree on it (LB-30).
 *
 * **A `boundingBox()` is a position, not a promise that the element is still there.** A sheet slides
 * in over `duration-500` and `toBeVisible()` is satisfied the moment it mounts, so a read taken
 * straight after is a coordinate the element is travelling through. Measured on the meal library:
 * the row read y=605 and sat at y=503 by the time the touch landed, so every point of the gesture
 * hit the scroll container beneath it and the drag handler was never invoked once — which reads as a
 * dead gesture rather than a mis-aimed one, and cost a week of BF-39 as a render-vs-remount question
 * it never was.
 *
 * **Use it wherever a coordinate is dispatched or asserted**, because neither
 * `Input.dispatchTouchEvent` nor `page.touchscreen.tap()` performs the stability check
 * `locator.tap()` does, and an assertion on a moving box gives a wrong verdict rather than a missed
 * tap. It is not a sleep: it returns as soon as two reads agree, so on a settled page it costs one
 * frame, and it replaces the hand-tuned `waitForTimeout` that used to stand in for it.
 */
export async function stableBox(row: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  let previous = await row.boundingBox()
  for (let attempt = 0; attempt < 60; attempt++) {
    await row.page().waitForTimeout(50)
    const next = await row.boundingBox()
    if (previous && next && Math.abs(previous.y - next.y) < 0.5 && Math.abs(previous.x - next.x) < 0.5) return next
    previous = next
  }
  throw new Error('the row never stopped moving — something is animating it indefinitely')
}

/**
 * Tap an element's centre with a real touch, once it has stopped moving.
 *
 * `page.touchscreen.tap()` is a CDP dispatch at a coordinate: no actionability check, no stability
 * check, and no complaint if the element left. Every spec that measured and then tapped was writing
 * this by hand, which is what made the class worth one helper (LB-30).
 *
 * `locator.tap()` is NOT the same thing and is not a substitute here — this app's screens read raw
 * touch events and several controls sit inside `[data-swipe-carousel]`, which is why these specs
 * dispatch touches rather than clicking (Q-354).
 */
export async function tapCentre(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeVisible({ timeout: 30_000 })
  const box = await stableBox(target)
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

/**
 * Suppress Home's first-open-of-day Morning Check-in prompt (OR-1).
 *
 * It is a **modal** Radix sheet, so while it is open Radix sets `aria-hidden="true"` on `<main>` and
 * `pointer-events: none` on `<body>`. Everything on Home leaves the accessibility tree with it —
 * measured: `getByLabel('Log Body Weight')` finds the button and
 * `getByRole('button', { name: 'Log Body Weight' })` finds **nothing**, on markup that is correct
 * and that resolves fine the moment the sheet is dismissed. So a Home spec does not fail with
 * "a modal is in the way"; it fails claiming the affordance it wants does not exist, which is a very
 * convincing wrong answer — it cost a trace through three components before the `<main>` attribute
 * was read.
 *
 * Every fresh browser profile is exposed: the prompt fires whenever `ta_morning_checkin` is absent
 * and the user has no `morning` check-in row for today, which is what CI provisions on every run.
 * Pre-setting the marker is what a returning user's browser already has.
 *
 * **But exposure is not the same as failing, and that distinction is why this sat unnoticed.** The
 * sheet opens after an async read (the local store on device, `/api/day-checkin` on web), so whether
 * it lands before or after a spec's first interaction is a **race**. That is why
 * `home-card-invalidation-refetch` passed for weeks and then did not (BF-23 dated the turn to
 * 2026-08-25 and read it as a content regression in one of six merges — it is not), and why
 * `score-band-not-colour-only` read as *flaky* rather than broken. **What made the race start
 * landing the other way was not established** — adding spec files shifts worker distribution and so
 * what runs before what, which is a plausible mechanism and was not proven. This fixture removes the
 * race rather than explaining it.
 *
 * The date must be the USER's, not the runner's — the marker is compared against `todayInTz(tz)`
 * (`session-select-content.tsx:107`), and the seeded user's zone is not the container's.
 *
 * Call before `page.goto`.
 */
export async function suppressMorningCheckin(page: Page): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const { Client } = await import('pg')
  const db = new Client({ connectionString })
  await db.connect()
  let today: string | undefined
  try {
    const { rows } = await db.query<{ d: string }>(
      `SELECT to_char(now() AT TIME ZONE coalesce(timezone, 'Australia/Brisbane'), 'YYYY-MM-DD') AS d
         FROM users WHERE email = $1`,
      [SEED_EMAIL],
    )
    today = rows[0]?.d
  } finally {
    await db.end()
  }
  expect(today, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
  await page.addInitScript(
    ([storageKey, value]) => localStorage.setItem(storageKey, value),
    ['ta_morning_checkin', today] as const,
  )
}
