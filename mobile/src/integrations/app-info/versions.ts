import { z } from 'zod';
import { backendOrigin } from '../../features/account/api/client.ts';

/** "App 0.1.0 (build 440887)"; the build part is left out when the code is '0' (module missing). */
export function appVersionLine(version: string, buildCode: string): string {
  return buildCode && buildCode !== '0' ? `App ${version} (build ${buildCode})` : `App ${version}`;
}

/** "Code 1a2b3c4"; CI bakes the full sha, a local run has 'dev'. */
export function codeVersionLine(sha: string | undefined): string {
  const value = sha?.trim();
  return `Code ${value && value !== 'dev' ? value.slice(0, 7) : 'dev'}`;
}

const StatusSchema = z.object({ version: z.string().min(1).max(40) });

/** The server's version from a `/api/status` body, or null when the body is not that shape. */
export function parseServerVersion(body: unknown): string | null {
  const parsed = StatusSchema.safeParse(body);
  return parsed.success ? parsed.data.version : null;
}

export function serverVersionLine(version: string | null): string {
  return version ? `Server ${version}` : 'Server unreachable';
}

/** GET /api/status (public). Resolves null on any failure: offline, non-2xx, bad body. */
export async function fetchServerVersion(
  baseUrl: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  try {
    if (!baseUrl) return null;
    const response = await fetcher(new URL('/api/status', backendOrigin(baseUrl)), {
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    return parseServerVersion(await response.json());
  } catch {
    return null;
  }
}
