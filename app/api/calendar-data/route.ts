import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const now = new Date();
  const year  = parseInt(searchParams.get("year")  ?? String(now.getFullYear()), 10);
  const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10);

  if (year < 2000 || year > 2100 || month < 1 || month > 12) {
    return NextResponse.json({ error: "Invalid year or month" }, { status: 400 });
  }

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { trainedDays, activityDays } = await (await getRepository()).getCalendarData(userId, year, month, session.user?.timezone);
  return NextResponse.json(
    { trainedDays, activityDays, year, month },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
