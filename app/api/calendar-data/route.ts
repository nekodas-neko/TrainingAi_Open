import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";

export async function GET(req: NextRequest) {
  // Auth first: the range check below answered 400 before anyone had proved who they were, which
  // tells an unauthenticated caller the route exists and what it accepts.
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const now = new Date();
  const year  = parseInt(searchParams.get("year")  ?? String(now.getFullYear()), 10);
  const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10);

  // `parseInt("abc")` is NaN, and every comparison against NaN is false — so `?year=abc` passed
  // this range check untouched and reached `getCalendarData`, which threw
  // `RangeError: Invalid time value` and answered a bodiless 500 (RV-177, measured 2026-09-25).
  if (!Number.isInteger(year) || !Number.isInteger(month) ||
      year < 2000 || year > 2100 || month < 1 || month > 12) {
    return NextResponse.json({ error: "Invalid year or month" }, { status: 400 });
  }

  const { trainedDays, activityDays } = await (await getRepository()).getCalendarData(userId, year, month, session.user?.timezone);
  return NextResponse.json(
    { trainedDays, activityDays, year, month },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
