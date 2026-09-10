import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

// LA-87 — ONE definition of "storage is configured", because there were two and they disagreed.
//
// `getS3()` resolved each variable with `??` and `isStorageConfigured()` with `||`. Those differ on
// exactly one value: the **empty string**. With `AWS_ENDPOINT_URL=""` set alongside a real
// `STORAGE_ENDPOINT`, `??` keeps the empty string and returns null, while `||` falls through to the
// real value and answers true — so callers were told storage was ready by a helper that the
// uploader itself disagreed with.
//
// That is what makes the "configured but the upload returned null" branch reachable at all, and it
// is the part LA-87's entry did not identify: the entry described the symptom (a base64 row
// reported as `'s3'`) and proposed reporting the path taken. Reporting it more accurately is worth
// doing and is done below, but the cause is two implementations of one predicate — a bug by
// definition under **One Formula, One Place**.
//
// An empty-string env var is not hypothetical in this deployment: Railway writes one for a variable
// that is defined-but-blank, which is what a half-finished storage setup leaves behind.
function storageCredentials(): { endpoint: string; accessKeyId: string; secretAccessKey: string } | null {
  const endpoint = process.env.AWS_ENDPOINT_URL || process.env.STORAGE_ENDPOINT;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.STORAGE_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, accessKeyId, secretAccessKey };
}

function getS3(): S3Client | null {
  const creds = storageCredentials();
  if (!creds) return null;
  return new S3Client({
    endpoint: creds.endpoint,
    region: process.env.AWS_DEFAULT_REGION ?? process.env.STORAGE_REGION ?? 'auto',
    credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
    forcePathStyle: true,
  });
}

function getBucket(): string {
  return process.env.AWS_S3_BUCKET_NAME ?? process.env.STORAGE_BUCKET_NAME ?? 'trainingai';
}

export function getPublicUrl(): string {
  const explicit = process.env.STORAGE_PUBLIC_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  // Derive from endpoint + bucket (Railway path-style)
  const endpoint = (process.env.AWS_ENDPOINT_URL ?? process.env.STORAGE_ENDPOINT ?? '').replace(/\/$/, '');
  const bucket = getBucket();
  return endpoint ? `${endpoint}/${bucket}` : '';
}

export async function uploadExerciseMedia(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<string | null> {
  const s3 = getS3();
  if (!s3) return null;

  await s3.send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  // Return a relative URL served through our own proxy — bucket stays private.
  // Strip the leading "exercise-media/" since the proxy route prepends it.
  return `/exercise-media/${key.replace(/^exercise-media\//, '')}`;
}

export const REFERENCE_FIGURE_KEY = 'exercise-media/reference-figure.png';

export async function downloadMedia(key: string): Promise<Buffer | null> {
  const s3 = getS3();
  if (!s3) return null;
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
    if (!res.Body) return null;
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

/**
 * Whether one key exists, and how big it is — for diagnostics that must tell "the file is absent"
 * apart from "we could not talk to the bucket".
 *
 * `downloadMedia` deliberately collapses both into `null`, which is right for a read path with a
 * fallback but wrong for a report: a rejected credential would render as eight missing files and
 * read as a failed upload. So a non-404 error is surfaced here rather than swallowed. (This exact
 * confusion cost a session — `scripts/upload-model-assets.js --check` reported every file absent
 * while the real problem was auth.)
 */
export async function statMedia(
  key: string,
): Promise<{ found: boolean; size: number | null; error: string | null }> {
  const s3 = getS3();
  if (!s3) return { found: false, size: null, error: 'storage not configured' };
  try {
    const res = await s3.send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }));
    return { found: true, size: res.ContentLength ?? null, error: null };
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    const name = (err as { name?: string })?.name ?? 'Error';
    if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') {
      return { found: false, size: null, error: null };
    }
    return { found: false, size: null, error: `${name}${status ? ` (${status})` : ''}` };
  }
}

/** Keys under `prefix`, or an error string. Used as a reachability preflight before per-key stats. */
export async function listMediaKeys(
  prefix: string,
): Promise<{ keys: string[]; error: string | null }> {
  const s3 = getS3();
  if (!s3) return { keys: [], error: 'storage not configured' };
  try {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: getBucket(), Prefix: prefix }));
    return { keys: (res.Contents ?? []).map(o => o.Key ?? '').filter(Boolean), error: null };
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    const name = (err as { name?: string })?.name ?? 'Error';
    return { keys: [], error: `${name}${status ? ` (${status})` : ''}` };
  }
}

export function mediaKey(exerciseName: string, gender: string, type: 'start' | 'end' | 'gif') {
  const slug = exerciseName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (type === 'gif') {
    return `exercise-media/gifs/${gender}/${slug}.gif`;
  }
  return `exercise-media/frames/${gender}/${slug}-${type}.png`;
}

// The same predicate `getS3()` uses, by construction rather than by two lists agreeing. Answering
// this differently from the uploader is what LA-87 was about.
export function isStorageConfigured(): boolean {
  return storageCredentials() !== null;
}
