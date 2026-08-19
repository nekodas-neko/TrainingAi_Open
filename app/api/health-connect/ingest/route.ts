import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { safeCompare } from "@/lib/security/constant-time";
import { getRepositoryAsync } from "@/lib/data";
import { DEFAULT_TZ, todayInTz } from "@trainingai/shared/date-utils";
import { rateLimit } from "@/lib/rate-limit";
import { readJsonLimited } from "@trainingai/shared/http/request-guards";
import { reportServerError } from '@/lib/observability'
import { resolveIngestDate } from "@trainingai/shared/validation/ingest-clock";

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

// Ten small numbers, a date and a secret. 16 KB is two orders of magnitude of headroom over the
// largest real Tasker payload, which is the point of a cap being generous but finite.
const MAX_INGEST_BODY_BYTES = 16 * 1024;

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  // SEC-I3: the success-side limiter below only bounds valid Tasker calls, so a
  // brute-force of the secret ran at unbounded throughput (the only unauthenticated
  // write into body_metrics). Gate ALL attempts per IP before the constant-time
  // compare — legit Tasker volume is ~1/min, far under this — and return the same
  // 401 body on trip so it stays indistinguishable from a bad secret.
  //
  // Q-498 moved this ABOVE the body read, which is the larger half of that finding: the read and
  // the Zod parse used to happen before any gate, so an unauthenticated caller holding no secret
  // made the server buffer and fully parse an arbitrary body — measured at 20,000,048 bytes — and
  // the limiter could not throttle it because it ran afterwards. The limiter is keyed on the IP
  // from the headers, so it needs nothing out of the body; the entry's suggestion of moving the
  // secret to a header to achieve this turned out not to be necessary, and would have broken the
  // owner's Tasker profile for no extra benefit.
  if (!rateLimit(`hc-ingest-fail:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const read = await readJsonLimited(req, MAX_INGEST_BODY_BYTES);
  if (!read.ok) {
    return read.reason === "too_large"
      ? NextResponse.json({ error: "Request too large" }, { status: 413 })
      : NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = IngestBodySchema.safeParse(read.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const body = parsed.data;

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
    // Q-494: the schema's regex bounds the date's SHAPE, nothing bounded its RANGE — so
    // `{"date":"9999/12/30","weightKg":499}` answered 200 and then owned
    // `getMostRecentConfirmedWeightKg`'s `ORDER BY date DESC LIMIT 1` permanently, feeding the BLE
    // scale's confirmation step and every `deriveActivityKcal` estimate. Routed through the shared
    // ingest clock rather than a bespoke check here, since three sibling ingest paths already use it.
    const dateIso = resolveIngestDate(body.date, todayInTz(tz));
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
