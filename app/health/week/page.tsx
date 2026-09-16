import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { DEFAULT_TZ, shiftDateStr, startOfWeekInTz } from "@trainingai/shared/date-utils";
import { WeekDetailContent } from "./week-detail-content";

/**
 * The week in review as a page (BF-5 PR 2b), alongside `/health/day` — the shape the owner named:
 * *"id rathee its own page that you can get to from a banner notifcation; or a permanent link in the
 * health tab somewhere - the page shohld be more indepth; kinda like the training calendar entry;
 * but for the whole week."*
 *
 * **No week parameter, deliberately.** `/api/weekly-digest` computes the recap week itself and reads
 * nothing from the body but `force`, so it can only ever answer for the week that has just ended —
 * and the plan's §6 keeps it that way (*"a page opening last week recomputes; if the owner ever
 * wants an arbitrary past week, that is a real query-range change and its own entry"*). A `?week=`
 * the route cannot honour would be a control that does nothing.
 *
 * The date computed here is the header's label before the fetch lands; the response's own
 * `weekStart` replaces it, so the two can never disagree on screen.
 */
export default async function WeekDetailPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  const tz = session.user.timezone ?? DEFAULT_TZ;
  return <WeekDetailContent initialWeek={shiftDateStr(startOfWeekInTz(tz), -7)} />;
}
