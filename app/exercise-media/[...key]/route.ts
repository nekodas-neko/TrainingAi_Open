import { downloadMedia } from '@/lib/exercise-storage';

// Proxy for S3-stored exercise media (GIFs, frames, reference figure).
// Allows the bucket to stay private — no public ACL or STORAGE_PUBLIC_URL needed.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  const s3Key = `exercise-media/${key.join('/')}`;
  const buffer = await downloadMedia(s3Key);
  if (!buffer) return new Response(null, { status: 404 });

  const filename = key[key.length - 1] ?? '';
  const contentType = filename.endsWith('.gif') ? 'image/gif'
    : filename.endsWith('.png') ? 'image/png'
    : 'image/jpeg';

  return new Response(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
