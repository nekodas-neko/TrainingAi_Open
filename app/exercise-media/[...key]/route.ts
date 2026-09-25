import { downloadMediaWithType } from '@/lib/exercise-storage';

// Proxy for S3-stored exercise media (GIFs, frames, reference figure).
// Allows the bucket to stay private — no public ACL or STORAGE_PUBLIC_URL needed.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  const s3Key = `exercise-media/${key.join('/')}`;
  const stored = await downloadMediaWithType(s3Key);
  if (!stored) return new Response(null, { status: 404 });

  // What the object was stored as beats what its name suggests. The extension is a guess about the
  // bytes; `ContentType` is what the upload actually declared, and serving the guess is how a JPEG
  // written to a `.png` key reaches the browser as an undecodable PNG (DV-18). The extension
  // remains the fallback, so objects written before anything set a type keep their old behaviour.
  const filename = key[key.length - 1] ?? '';
  const contentType = stored.contentType
    ?? (filename.endsWith('.gif') ? 'image/gif'
      : filename.endsWith('.png') ? 'image/png'
      : 'image/jpeg');

  return new Response(stored.buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
