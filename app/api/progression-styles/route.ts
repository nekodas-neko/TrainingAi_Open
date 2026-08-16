import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import type { ProgressionStyle } from "@trainingai/shared/types";

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

  const body = await req.json() as { style: ProgressionStyle };
  if (!body.style?.name || !Array.isArray(body.style.sets)) {
    return NextResponse.json({ error: "Invalid style" }, { status: 400 });
  }
  if (body.style.sets.length > 40) {
    return NextResponse.json({ error: 'Too many sets' }, { status: 413 });
  }

  const saved = await (await getRepository()).saveProgressionStyle(userId, {
    ...body.style,
    userId,
    id: body.style.id ?? '',
  });
  return NextResponse.json({ ok: true, style: saved });
}

export async function DELETE(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { id?: string; name?: string };
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
