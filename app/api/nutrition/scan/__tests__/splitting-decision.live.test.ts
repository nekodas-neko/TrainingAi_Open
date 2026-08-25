// BF-11b's actual risk is a MODEL behaviour, and a mocked test cannot see it: one plated
// curry-rice-naan is ONE meal, five labelled tubs are FIVE. Its sibling
// `multi-candidate.test.ts` pins the route's handling; this pins the split.
//
// ⚠️ THIS DOES NOT RUN IN CI, AND THAT IS DELIBERATE. It makes real Gemini calls, so it is gated on
// an explicit opt-in rather than on the API key merely being present — a key in the CI environment
// must not silently turn every PR into a paid, non-deterministic run. To run it:
//
//     RUN_LIVE_AI_TESTS=1 GOOGLE_GENERATIVE_AI_API_KEY=… npx vitest run app/api/nutrition/scan
//
// Measured 2026-08-25 against `aiModel()`, five runs per case, on the shipped prompt: **30 of 30
// correct** across the six cases below.
//
// That number is only meaningful next to the one before it. The first version of rule 5 ended
// *"When in doubt, return one"*, which fought its own repeated-portion clause: five IDENTICAL tubs
// came back **5, 5, 1, 1, 5, 1** — a coin flip on the feature's headline case, found by measuring
// rather than by one passing run. Splitting the rule into "unsure whether components share a plate
// → one" and "separate portions are separate EVEN WHEN IDENTICAL" took it to 6 of 6, and the
// one-plate direction was then re-measured to prove the seesaw had not tipped the other way.
//
// Assert COUNTS, never calories — a calorie assertion turns this into a model snapshot that fails
// on every prompt tweak for no reason, which is the trap the plan calls out.
import { describe, it, expect, vi } from 'vitest'

const live = process.env.RUN_LIVE_AI_TESTS === '1' && !!process.env.GOOGLE_GENERATIVE_AI_API_KEY
const USER = '00000000-0000-4000-8000-0000000bf11c'

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER, timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

async function candidateCount(text: string): Promise<{ n: number; names: string[] }> {
  const { POST } = await import('@/app/api/nutrition/scan/route')
  const res = await POST(new Request('http://test/api/nutrition/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
  }))
  expect(res.status).toBe(200)
  const body = await res.json()
  return { n: body.candidates?.length ?? 0, names: (body.candidates ?? []).map((c: { name: string }) => c.name) }
}

describe.skipIf(!live)('the splitting decision, against the real model (BF-11b)', () => {
  it('splits five meal-prep containers into five', async () => {
    const { n } = await candidateCount(
      'five meal-prep containers, each holding 150g grilled chicken, 200g white rice and 100g broccoli')
    expect(n).toBe(5)
  }, 120_000)

  it('keeps one plated meal as one, however many components it has', async () => {
    const { n } = await candidateCount('a plated dinner of chicken curry with basmati rice and a garlic naan')
    expect(n).toBe(1)
  }, 120_000)

  it('keeps a single food as one', async () => {
    const { n } = await candidateCount('a medium banana')
    expect(n).toBe(1)
  }, 120_000)

  it('splits two meals eaten on separate occasions', async () => {
    const { n, names } = await candidateCount(
      'lunch was a chicken caesar wrap; dinner was spaghetti bolognese with garlic bread')
    expect(n).toBe(2)
    expect(names.join(' ').toLowerCase()).toContain('wrap')
    expect(names.join(' ').toLowerCase()).toContain('bolognese')
  }, 120_000)

  // The seesaw case. Sharpening the rule so identical portions split reliably is exactly the change
  // that could start splitting one crowded plate into six, so this is measured alongside it.
  it('keeps a six-component plate as one', async () => {
    const { n } = await candidateCount(
      'a large mixed grill: steak, two sausages, half a chicken, chips, salad and a fried egg')
    expect(n).toBe(1)
  }, 120_000)

  // Identical portions are the case that was a coin flip before rule 5 was split in two.
  it('splits three identical tubs into three', async () => {
    const { n } = await candidateCount('three identical tubs of beef chilli with rice')
    expect(n).toBe(3)
  }, 120_000)
})
