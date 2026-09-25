import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
// OR-166 — the SCOPED client, not the `googleapis` umbrella. Same generated Calendar v3 code;
// `googleapis` bundles every Google API alongside it, which is 203 MB against this one's 884 kB,
// and Next traces the whole import graph for the server bundle on every build.
import { auth as googleAuth, calendar as calendarApi } from "@googleapis/calendar";
import { reportServerError } from '@/lib/observability'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { rateLimit } from '@/lib/rate-limit'
import { z } from 'zod'

// One calendar event.
const MAX_BODY_BYTES = 16 * 1024

// A write to an external service on workout completion. Far above real use — a handful of sessions
// a day — but it bounds a client stuck in a retry loop, which is what the rule asks for (RV-177).
const RATE_LIMIT_PER_HOUR = 30

/** Well past any real session; the 16 kB body cap is the binding limit. */
const MAX_EXERCISES = 500
/** How many reach the event description, unchanged from before this schema existed. */
const DESCRIPTION_EXERCISE_CAP = 50

// `new Date(startMs).toISOString()` throws RangeError outside the Date range, and the old
// `!startMs` guard passed anything truthy — a string, a float, 1e20 — straight into it, so a bad
// client body was a bodiless 500 rather than a 400. Bounded to a plausible calendar window rather
// than to Date's own +/-8.64e15, which would still accept the year 200000.
const MS_LOWER = Date.UTC(2000, 0, 1)
const MS_UPPER = Date.UTC(2100, 0, 1)
const EventBody = z.object({
  sessionType: z.string().trim().min(1).max(120),
  startMs: z.number().int().min(MS_LOWER).max(MS_UPPER),
  endMs: z.number().int().min(MS_LOWER).max(MS_UPPER),
  exercises: z.array(z.object({
    name: z.string().max(200),
    setWeights: z.array(z.number()).max(50).default([]),
    reps: z.array(z.number()).max(50).default([]),
  // Bounded but NOT capped at 50: the route has always TRUNCATED a long list into the description
  // rather than refusing it, and `feedback-calendar-scale-routes.test.ts` pins that. A `.max(50)`
  // here turned a 60-exercise session into a 400 — the event simply never reached the calendar.
  // The ceiling is a sanity bound (the 16 kB body limit is the real one); the slice below is the
  // behaviour.
  })).max(MAX_EXERCISES).default([]),
}).strict().refine(b => b.endMs >= b.startMs, { message: 'endMs precedes startMs', path: ['endMs'] })

function makeOAuth2(refreshToken: string) {
  const oauth2 = new googleAuth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI!,
  );
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const refreshToken = session?.refreshToken;
  if (!refreshToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session?.user?.id ?? 'anon';
  if (!rateLimit(`${userId}:log-calendar-event`, RATE_LIMIT_PER_HOUR, 3_600_000)) {
    return NextResponse.json({ error: 'Too many requests — try again shortly.' }, { status: 429 });
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = EventBody.safeParse(read.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { sessionType, startMs, endMs, exercises } = parsed.data;

  const oauthClient = makeOAuth2(refreshToken);
  const calendar = calendarApi({ version: "v3", auth: oauthClient });

  const description = exercises
    .slice(0, DESCRIPTION_EXERCISE_CAP)
    .map((ex) => {
      const sets = (ex.setWeights ?? [])
        .map((w, i) => `  Set ${i + 1}: ${w}kg × ${ex.reps?.[i] ?? "?"}`)
        .join("\n");
      return `${ex.name}\n${sets}`;
    })
    .join("\n\n");

  try {
    const event = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: `${sessionType} · TrainingAI`,
        description,
        start: { dateTime: new Date(startMs).toISOString() },
        end: { dateTime: new Date(endMs).toISOString() },
      },
    });
    return NextResponse.json({ success: true, eventId: event.data.id });
  } catch (err: unknown) {
    const errStr = String(err);
    const errMsg = err instanceof Error ? err.message : errStr;
    const errCode = (err instanceof Object && "code" in err) ? (err as { code?: string }).code : undefined;
    console.error("[log-calendar-event] error:", { message: errMsg.slice(0, 200), code: errCode });
    if (
      errStr.includes("403") ||
      errMsg.toLowerCase().includes("forbidden") ||
      errMsg.toLowerCase().includes("insufficientpermissions") ||
      errMsg.toLowerCase().includes("calendar") ||
      errCode === "ERR_HTTP_403"
    ) {
      return NextResponse.json({ code: "CALENDAR_SCOPE_MISSING" }, { status: 403 });
    }
    // Past the scope branch only — a missing calendar grant is the user's consent state, not a
    // server fault, and it is the common case on this route.
    reportServerError(err, { url: '/api/log-calendar-event' });
    return NextResponse.json({ error: "Calendar write failed" }, { status: 500 });
  }
}
