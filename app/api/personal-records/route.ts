import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";

// LB-95: the caller's all-time personal records, every exercise, newest first, each with the date
// it was achieved. Not filtered to the active program: a lifetime best on an exercise no longer
// programmed is what a lifetime-best list is for.
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const repo = await getRepository();
  const rows = await repo.listPersonalRecordsDated(userId);
  const records = rows.map(r => ({
    exerciseName: r.exerciseName,
    estimated1rm: r.estimated1rm,
    achievedAt: r.achievedAt.toISOString(),
  }));
  return NextResponse.json({ records }, { headers: { "Cache-Control": "private, no-store" } });
}
