import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import { todayInTz, DEFAULT_TZ } from "@trainingai/shared/date-utils";

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { programId?: string };

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const today = todayInTz(tz)

  const repo = await getRepository();
  const activeProgram = await repo.getActiveProgram(userId)
  if (!activeProgram) return NextResponse.json({ error: "No active program" }, { status: 400 });

  // Only allow deloading the currently active program
  const programId = body.programId ?? activeProgram.id
  if (programId !== activeProgram.id) {
    return NextResponse.json({ error: "Can only early-deload the active program" }, { status: 403 });
  }

  await repo.confirmEarlyDeload(userId, programId, today);
  return NextResponse.json({ ok: true, earlyDeloadWeekStart: today, programId });
}
