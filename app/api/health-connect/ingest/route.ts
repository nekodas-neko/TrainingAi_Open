import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { safeCompare } from "@/lib/security/constant-time";
import { getRepositoryAsync } from "@/lib/data";
import { formatInTimeZone } from "date-fns-tz";
import { DEFAULT_TZ } from "@trainingai/shared/date-utils";
import { rateLimit } from "@/lib/rate-limit";
import { reportServerError } from '@/lib/observability'

// Called by Tasker on Android — no session cookie, auth via shared secret.
// Set HEALTH_CONNECT_INGEST_SECRET in Railway env vars.

// Tasker sends explicit `null` for fields it has no reading for today (not
// omission), so every numeric field is nullable as well as optional — range
// bounds are generous but reject clearly-garbage values (a stringified "75kg",
// a 1e308 double) before they reach the driver.
const IngestBodySchema = z.object({
  secret: z.string(),
  // The mirror of the dash-only problem: slash-only here would reject a dashed date from
  // Tasker, which is the one client that fills this (Q-130).
  date: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/).optional(),
  weightKg:   z.coerce.number().min(0).max(500).nullable().optional(),
  bodyFat:    z.coerce.number().min(0).max(100).nullable().optional(),
  steps:      z.coerce.number().int().min(0).max(200_000).nullable().optional(),
  calories:   z.coerce.number().min(0).max(20_000).nullable().optional(),
  protein:    z.coerce.number().min(0).max(2_000).nullable().optional(),
  carb:       z.coerce.number().min(0).max(2_000).nullable().optional(),
  fat:        z.coerce.number().min(0).max(2_000).nullable().optional(),
  distanceKm: z.coerce.number().min(0).max(500).nullable().optional(),
});

export async function POST(req: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = IngestBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const body = parsed.data;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  // SEC-I3: the success-side limiter below only bounds valid Tasker calls, so a
  // brute-force of the secret ran at unbounded throughput (the only unauthenticated
  // write into body_metrics). Gate ALL attempts per IP before the constant-time
  // compare — legit Tasker volume is ~1/min, far under this — and return the same
  // 401 body on trip so it stays indistinguishable from a bad secret.
  if (!rateLimit(`hc-ingest-fail:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expectedSecret = process.env.HEALTH_CONNECT_INGEST_SECRET;
  if (!expectedSecret || !safeCompare(body.secret, expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Success-side per-IP limiter for valid Tasker calls (kept separate from the
  // brute-force gate above).
  if (!rateLimit(`hc-ingest:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const userId = process.env.WEBHOOK_USER_ID;
  if (!userId) return NextResponse.json({ error: "Server not configured (WEBHOOK_USER_ID missing)" }, { status: 500 });

  try {
    const repo = await getRepositoryAsync();
    const webhookUser = await repo.getUserById(userId);
    const tz = webhookUser?.timezone ?? DEFAULT_TZ;
    const dateSlash = body.date ?? formatInTimeZone(new Date(), tz, "yyyy/MM/dd");
    const dateIso = dateSlash.replace(/\//g, "-").slice(0, 10);
    await repo.upsertBodyMetrics(userId, [{
      date: dateIso,
      weightKg:   body.weightKg   ?? undefined,
      bodyFatPct: body.bodyFat    ?? undefined,
      steps:      body.steps      ?? undefined,
      calories:   body.calories   ?? undefined,
      proteinG:   body.protein    ?? undefined,
      carbsG:     body.carb       ?? undefined,
      fatG:       body.fat        ?? undefined,
      distanceKm: body.distanceKm ?? undefined,
    }], 'health_connect');
    return NextResponse.json({ success: true, date: dateIso });
  } catch (err) {
    reportServerError(err, { userId, url: '/api/health-connect/ingest' })
    console.error("[health-connect/ingest]", String(err).slice(0, 200));
    return NextResponse.json({ error: "Write failed" }, { status: 500 });
  }
}
