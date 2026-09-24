import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { requireAdmin, adminErrorResponse } from '@/lib/admin';
import { rateLimit } from '@/lib/rate-limit';
import { uploadExerciseMedia, downloadMedia, REFERENCE_FIGURE_KEY, isStorageConfigured } from '@/lib/exercise-storage';
import { StatusCodes } from 'http-status-codes';
import { sniffImageMime } from '@trainingai/shared/http/request-guards';

export async function GET() {
  const session = await auth();
  try {
    await requireAdmin(session?.user?.id ?? '', session?.user?.isAdmin);
  } catch (err) {
    return adminErrorResponse(err);
  }

  // Q-134: these media routes were the only admin routes with no limit at all, while every
  // other AI/expensive one has had one since creation. Admin-gated, so the exposure is a
  // mis-click or a runaway client loop rather than an attacker — but generation is slow and
  // paid, which is exactly what a limit is for.
  if (!rateLimit(`admin-reference-figure:${session?.user?.id ?? 'anon'}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const exists = !!(await downloadMedia(REFERENCE_FIGURE_KEY).catch(() => null));
  const url = exists ? `/exercise-media/${REFERENCE_FIGURE_KEY.replace(/^exercise-media\//, '')}` : null;
  return NextResponse.json({ url, storageConfigured: isStorageConfigured() });
}

export async function POST(req: Request) {
  const session = await auth();
  try {
    await requireAdmin(session?.user?.id ?? '', session?.user?.isAdmin);
  } catch (err) {
    return adminErrorResponse(err);
  }

  // Same limit as the sibling handler above (Q-134).
  if (!rateLimit(`admin-reference-figure:${session?.user?.id ?? 'anon'}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  if (!isStorageConfigured()) {
    return NextResponse.json(
      { error: 'S3 storage not configured — add AWS env vars first' },
      { status: StatusCodes.BAD_REQUEST },
    );
  }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: StatusCodes.BAD_REQUEST });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // The bytes decide, not the filename and not a constant. This used to store every upload as
  // `image/png` whatever arrived, and the phone that feeds it shoots HEIC and JPEG — so a wrong
  // type was written silently and only showed up later as a picture that would not decode (DV-18).
  // Rejecting here rather than converting: an unsupported file is the admin's to re-export, and a
  // clear 400 is a better answer than a transcode this route has no business doing.
  const detected = sniffImageMime(buffer);
  if (!detected) {
    return NextResponse.json(
      { error: 'Unsupported image — send a PNG, JPEG or WebP (HEIC from the phone camera is not one)' },
      { status: StatusCodes.BAD_REQUEST },
    );
  }
  const url = await uploadExerciseMedia(REFERENCE_FIGURE_KEY, buffer, detected);
  return NextResponse.json({ url });
}
