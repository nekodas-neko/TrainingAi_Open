import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { rateLimit } from "@/lib/rate-limit";
import { reportServerError } from "@/lib/observability";
import { GET as serveMedia } from "@/app/exercise-media/[...key]/route";

const Key = z
  .array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/))
  .min(1)
  .max(8);

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = Key.safeParse((await context.params).key);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid media path" }, { status: 400 });
  }
  if (!rateLimit(`exercise-media:${userId}`, 180, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  try {
    const response = await serveMedia(request, {
      params: Promise.resolve({ key: parsed.data }),
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    reportServerError(error, { userId, url: "/api/exercise-media" });
    return NextResponse.json(
      { error: "Could not load exercise media" },
      { status: 502 },
    );
  }
}
