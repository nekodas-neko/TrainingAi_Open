import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import type { ProgressionStyle } from "@trainingai/shared/types";
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { withRouteErrors } from '@/lib/api/route-errors'

// A progression style with its per-set rows.
const MAX_BODY_BYTES = 256 * 1024

async function getUserId() {
  const session = await auth();
  return session?.user?.id;
}

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const styles = await (await getRepository()).listProgressionStyles(userId);
  return NextResponse.json({ styles }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const body = (read.body ?? {}) as { style: ProgressionStyle };
  if (!body.style?.name || !Array.isArray(body.style.sets)) {
    return NextResponse.json({ error: "Invalid style" }, { status: 400 });
  }
  if (body.style.sets.length > 40) {
    return NextResponse.json({ error: 'Too many sets' }, { status: 413 });
  }

  // RV-33: `saveProgressionStyle` throws `NotFoundError` for a style id owned by someone else — the
  // correct refusal — and with no guard here it escaped as an empty-bodied 500 and an `error_events`
  // row filed as a server fault. Same miss Q-463 fixed on the sibling `[id]` routes.
  return withRouteErrors(async () => {
    const saved = await (await getRepository()).saveProgressionStyle(userId, {
      ...body.style,
      userId,
      id: body.style.id ?? '',
    });
    return NextResponse.json({ ok: true, style: saved });
  });
}

export async function DELETE(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const body = (read.body ?? {}) as { id?: string; name?: string };
  if (!body.id && !body.name) return NextResponse.json({ error: "Missing id or name" }, { status: 400 });

  const repo = await getRepository();
  if (body.id) {
    await repo.deleteProgressionStyle(userId, body.id);
  } else {
    // Look up by name
    const styles = await repo.listProgressionStyles(userId);
    const style = styles.find(s => s.name === body.name);
    if (style) await repo.deleteProgressionStyle(userId, style.id);
  }
  return NextResponse.json({ ok: true });
}
