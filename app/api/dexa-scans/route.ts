import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import { readJsonLimited } from "@trainingai/shared/http/request-guards";

// BF-41 / BF-2: where a DEXA scan lands. Hand entry today; the crop-and-extract surface (Lane B)
// posts the same shape once the owner has confirmed the parsed fields, which is why `source`
// distinguishes the two and why there is no branch here that stores an unconfirmed extraction.
//
// The schema is written from the real Hologic printout recorded, de-identified, in
// `docs/clinical-baseline-2026-08-27.md` — BF-41's own rule, and the same rule this repo applies to
// external API fields: read the source, never memory.
//
// 12 regions x 4 fields plus ~35 scalars. 16 KB is generous and still a cap.
const MAX_BODY_BYTES = 16 * 1024;

/** Bounds are plausibility, not validation theatre — the same posture as `measured-rmr`. A value
 *  outside these is a typo or a unit mix-up (grams entered as kilograms is the likely one), and
 *  storing it would quietly move BF-2's calibration and BF-33's FFM comparison. */
const pct = z.number().min(0).max(100).nullish();
const grams = z.number().min(0).max(500_000).nullish();
const ratio = z.number().min(0).max(100).nullish();

const RegionSchema = z.object({
  // Free text rather than an enum: the region vocabulary is the PROVIDER's, and a different machine
  // naming it `L_Arm` or `Left Arm` must not be rejected. `subtotal` and `total` arrive here too —
  // they are aggregates the printout prints alongside the regions, so anything summing this must
  // exclude them.
  region: z.string().min(1).max(60),
  bmd: z.number().min(0).max(10).nullish(),
  bmcG: grams,
  areaCm2: z.number().min(0).max(10_000).nullish(),
}).strict();

const PostSchema = z.object({
  // Both separators: the client's `localDateString()` emits YYYY/MM/DD, and a dash-only regex
  // rejects every real request before the handler runs.
  scannedOn: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/),

  manufacturer: z.string().max(120).nullish(),
  model: z.string().max(120).nullish(),
  serialNumber: z.string().max(120).nullish(),
  scanType: z.string().max(200).nullish(),
  analysisVersion: z.string().max(60).nullish(),
  providerScanId: z.string().max(120).nullish(),

  heightCm: z.number().min(50).max(280).nullish(),
  weightKg: z.number().min(20).max(400).nullish(),
  ageYears: z.number().int().min(0).max(130).nullish(),
  bmi: z.number().min(5).max(100).nullish(),

  totalBmd: z.number().min(0).max(10).nullish(),
  // T and Z scores are standard deviations and are routinely negative — the owner's are −1.6. A
  // `min(0)` here would reject every osteopenic result, which is most of the ones worth storing.
  tScore: z.number().min(-15).max(15).nullish(),
  zScore: z.number().min(-15).max(15).nullish(),
  totalBmcG: grams,
  bmdPrecisionCvPct: pct,

  fatG: grams,
  leanG: grams,
  leanPlusBmcG: grams,
  totalMassG: grams,
  pctFat: pct,
  // Percentiles, not percentages — same 0..100 range, different meaning, and the column names are
  // the only thing that says so.
  pctFatYoungNormal: z.number().int().min(0).max(100).nullish(),
  pctFatAgeMatched: z.number().int().min(0).max(100).nullish(),
  androidPctFat: pct,
  gynoidPctFat: pct,

  fatMassHeight2: z.number().min(0).max(100).nullish(),
  androidGynoidRatio: ratio,
  pctFatTrunkLegs: ratio,
  trunkLimbFatMassRatio: ratio,
  vatMassG: grams,
  vatVolumeCm3: z.number().min(0).max(100_000).nullish(),
  vatAreaCm2: z.number().min(0).max(10_000).nullish(),

  leanHeight2: z.number().min(0).max(100).nullish(),
  appendicularLeanHeight2: z.number().min(0).max(100).nullish(),

  boneReference: z.string().max(200).nullish(),
  bodyCompReference: z.string().max(200).nullish(),

  // Provenance. `extracted` means a model read it AND the owner confirmed it — there is no third
  // value for "a model said so", because nothing unconfirmed should reach this table
  // (CLAUDE.md: no LLM self-reported number may be shown as fact).
  source: z.enum(["manual", "extracted"]).optional(),
  notes: z.string().max(4000).nullish(),

  // 12 on the owner's printout; the cap is a bound, not a schema claim about how many exist.
  regions: z.array(RegionSchema).max(40).optional(),
}).strict();

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const repo = await getRepository();
  // The list, not just the latest: BF-2's calibration is a series of paired observations, and one
  // pair cannot tell an offset from a ratio.
  return NextResponse.json(
    { scans: await repo.listDexaScans(userId) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return NextResponse.json(
      { error: read.reason === "too_large" ? "Request too large" : "Invalid body" },
      { status: read.reason === "too_large" ? 413 : 400 },
    );
  }

  const parsed = PostSchema.safeParse(read.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid DEXA scan", detail: parsed.error.issues }, { status: 400 });
  }

  const { scannedOn, regions, ...rest } = parsed.data;
  // A repeated region would silently drop one of the two at the unique index; refuse instead, so a
  // mis-parsed printout is a visible error rather than a scan missing a leg.
  if (regions && new Set(regions.map(r => r.region.trim().toLowerCase())).size !== regions.length) {
    return NextResponse.json({ error: "Duplicate region in scan" }, { status: 400 });
  }

  const repo = await getRepository();
  await repo.saveDexaScan(userId, { scannedOn: scannedOn.replace(/\//g, "-"), regions, ...rest });

  return NextResponse.json({ ok: true });
}
