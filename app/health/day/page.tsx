import { auth } from "@/auth";
import { todayInTz, normalizeDateParam, DEFAULT_TZ } from "@trainingai/shared/date-utils";
import { DayDetailContent } from "./day-detail-content";

export default async function DayDetailPage({
  searchParams,
}: { searchParams: Promise<{ date?: string }> }) {
  const session = await auth();
  const tz = session?.user?.timezone ?? DEFAULT_TZ;
  const { date } = await searchParams;
  // The date is a starting point only — swiping changes it client-side, so a bad param falls back
  // to today rather than 404ing a screen the user reached from a calendar tap.
  const initialDate = (date && normalizeDateParam(date)?.replace(/\//g, "-")) || todayInTz(tz);
  return <DayDetailContent initialDate={initialDate} tz={tz} userId={session?.user?.id} />;
}
