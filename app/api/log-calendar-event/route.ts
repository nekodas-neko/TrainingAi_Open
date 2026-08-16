import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { google } from "googleapis";
import { reportServerError } from '@/lib/observability'

function makeOAuth2(refreshToken: string) {
  const oauth2 = new google.auth.OAuth2(
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

  let body: {
    sessionType: string;
    startMs: number;
    endMs: number;
    exercises: { name: string; setWeights: number[]; reps: number[] }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sessionType, startMs, endMs } = body;
  if (!sessionType || !startMs || !endMs) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  const exercises = Array.isArray(body.exercises) ? body.exercises.slice(0, 50) : [];

  const oauthClient = makeOAuth2(refreshToken);
  const calendar = google.calendar({ version: "v3", auth: oauthClient });

  const description = exercises
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
