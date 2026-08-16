import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { generateObject } from 'ai'
import { aiModel, loggedGenerateObject } from '@/lib/ai/instrument'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited, isAllowedImageMime } from '@trainingai/shared/http/request-guards'
import { reportServerError } from '@/lib/observability'
import { sumIngredients, sanitiseNutrition } from '@trainingai/shared/nutrition/scan-totals'
import { z } from 'zod'

const REGION_CONTEXT: Record<string, string> = {
  AU: 'Assume products from Australian supermarkets (Coles, Woolworths, Aldi) where applicable.',
  US: "Assume products from US supermarkets (Walmart, Kroger, Whole Foods) where applicable.",
  UK: "Assume products from UK supermarkets (Tesco, Sainsbury's, ASDA) where applicable.",
  NZ: 'Assume products from New Zealand supermarkets (Countdown, Pak\'nSave, New World) where applicable.',
}

const IngredientSchema = z.object({
  name: z.string(),
  weightG: z.number(),
  caloriesPer100g: z.number(),
  proteinPer100g: z.number(),
  carbsPer100g: z.number(),
  fatPer100g: z.number(),
})

const ScanSchema = z.object({
  identified: z.boolean(),
  name: z.string(),
  brand: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  notes: z.string().nullable(),
  fiberG: z.number(),
  sugarG: z.number(),
  sodiumMg: z.number(),
  satFatG: z.number(),
  ingredients: z.array(IngredientSchema),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`${session.user.id}:nutrition-scan`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // 5 MB of raw image bytes ≈ 6.8 MB base64 chars; 8 MB covers JSON overhead.
  const MAX_BODY_BYTES = 8 * 1024 * 1024
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const body = read.body as Record<string, unknown>

  const MAX_BASE64_BYTES = 5 * 1024 * 1024
  if (typeof body.image === 'string' && Buffer.byteLength(body.image, 'base64') > MAX_BASE64_BYTES) {
    return NextResponse.json({ error: 'Image too large' }, { status: 413 })
  }

  const region: string = typeof body.region === 'string' ? body.region : 'AU'
  const regionHint = REGION_CONTEXT[region] ?? REGION_CONTEXT['AU']

  const systemPrompt = `You are a nutrition expert. ${regionHint}
Rules:
1. Estimate for the EXACT portion described — not per 100g. If the user says "200g", the ingredient weights must total 200g. If no weight is given, use a typical single serving.
2. ALWAYS populate "ingredients" — one entry per component with its estimated weight in grams and its per-100g calories/protein/carbs/fat. For a simple single food (a banana, a protein bar) return exactly one ingredient covering the whole portion. Totals are computed from this list, so the weights and per-100g values are what matter.
3. fiberG, sugarG, sodiumMg, satFatG are for the whole portion.
4. If you cannot identify any food, set identified=false and leave ingredients empty.`

  try {
    let result

    if (body.image && body.mimeType) {
      if (!isAllowedImageMime(body.mimeType)) {
        return NextResponse.json({ error: 'Unsupported image type' }, { status: 415 })
      }
      const mimeType = body.mimeType
      const imageBuffer = Buffer.from(body.image as string, 'base64')
      const userNote = typeof body.text === 'string'
        ? String(body.text).slice(0, 500).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim()
        : ''
      const prompt = userNote
        ? `Analyse this food photo. Additional context from user: "${userNote}". Return the nutrition JSON.`
        : 'Analyse this food photo and return the nutrition JSON.'
      result = await loggedGenerateObject(
        { section: 'nutrition-scan', userId: session.user.id, fingerprint: { mode: 'image', note: userNote } },
        () => generateObject({
          model: aiModel(),
          schema: ScanSchema,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', image: imageBuffer, mediaType: mimeType },
                { type: 'text', text: prompt },
              ],
            },
          ],
          system: systemPrompt,
          maxRetries: 0,
        }),
      )
    } else if (body.text) {
      if (typeof body.text !== 'string') {
        return NextResponse.json({ error: 'text must be a string' }, { status: 400 })
      }
      // Cap at 500 chars to prevent prompt injection and runaway token use
      const safeText = String(body.text).slice(0, 500).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
      result = await loggedGenerateObject(
        { section: 'nutrition-scan', userId: session.user.id, fingerprint: { mode: 'text', text: safeText } },
        () => generateObject({
          model: aiModel(),
          schema: ScanSchema,
          system: systemPrompt,
          prompt: `Estimate the nutrition for: ${safeText}`,
          maxRetries: 0,
        }),
      )
    } else {
      return NextResponse.json({ error: 'Provide image+mimeType or text' }, { status: 400 })
    }

    const scan = result.object
    if (!scan.identified || scan.ingredients.length === 0) {
      return NextResponse.json({ error: 'Could not identify food' })
    }

    const totals = sumIngredients(scan.ingredients)
    return NextResponse.json(sanitiseNutrition({
      name: scan.name,
      brand: scan.brand ?? undefined,
      servingSizeG: totals.servingSizeG,
      calories: totals.calories,
      proteinG: totals.proteinG,
      carbsG: totals.carbsG,
      fatG: totals.fatG,
      fiberG: scan.fiberG,
      sugarG: scan.sugarG,
      sodiumMg: scan.sodiumMg,
      satFatG: scan.satFatG,
      confidence: scan.confidence,
      notes: scan.notes ?? undefined,
      ingredients: scan.ingredients,
    }))
  } catch (err) {
    console.error('Gemini scan error:', err)
    // Report it, don't just log it. This catch existed but only wrote to stdout, so 30 days of
    // `error_events` held nothing for this route while it was the food-logging path the owner
    // actually uses — a scan failing repeatedly was invisible unless someone read Railway's log by
    // hand. Its sibling AI routes have reported since they were written (Q-218).
    reportServerError(err, { userId: session.user.id, url: '/api/nutrition/scan' })
    return NextResponse.json({ error: 'AI service unavailable. Please try again.' }, { status: 502 })
  }
}
