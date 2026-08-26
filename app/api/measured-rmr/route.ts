import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import { readJsonLimited } from "@trainingai/shared/http/request-guards";

// BF-33: where a clinically measured RMR lands. The owner has a DEXA + RMR test booked and the app
// had nowhere to put the result — every resting rate it uses today is predicted.
const MAX_BODY_BYTES = 4 * 1024;

const PostSchema = z.object({
  // Both separators: the client's `localDateString()` emits YYYY/MM/DD, and a dash-only regex
  // rejects every real request before the handler runs (CLAUDE.md, the ai-chat localDate bug).
  measuredOn: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/),
  // Bounds are plausibility, not validation theatre: a human resting rate outside this is a typo
  // or a unit mix-up, and storing it would silently move the calorie target.
  rmrKcal: z.number().int().min(500).max(5000),
  ffmKgAtTest: z.number().min(10).max(200).nullish(),
  weightKgAtTest: z.number().min(20).max(400).nullish(),
  method: z.string().max(120).nullish(),
  provider: z.string().max(200).nullish(),
  notes: z.string().max(2000).nullish(),
}).strict();

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const repo = await getRepository();
  // The list, not just the latest: two measurements at different body compositions are how you see
  // whether the first is still describing this person, which is why they sit beside each other.
  return NextResponse.json({ tests: await repo.listMeasuredRmr(userId) });
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
    return NextResponse.json({ error: "Invalid measured RMR", detail: parsed.error.issues }, { status: 400 });
  }

  const { measuredOn, ...rest } = parsed.data;
  const repo = await getRepository();
  await repo.saveMeasuredRmr(userId, { measuredOn: measuredOn.replace(/\//g, "-"), ...rest });

  return NextResponse.json({ ok: true });
}
