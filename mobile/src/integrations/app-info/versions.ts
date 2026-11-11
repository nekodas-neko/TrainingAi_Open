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

// #3723. The newest published release build of the real app, from `/api/version`
// (`nativeReleaseBuild`, read from the `native-release-latest` release). Publishing starts only
// after the switch-over, so until then the field is null, and on a server from before it, absent.
const RELEASE_PAGE = 'https://github.com/nekodas-neko/TrainingAi_Open/releases/tag/native-release-latest';
const ReleaseBuildSchema = z.object({
  versionName: z.string().regex(/^\d+\.\d+\.\d+$/),
  versionCode: z.number().int().positive().max(2_100_000_000),
  // Only ever the rolling release page: this is opened in the browser.
  pageUrl: z.literal(RELEASE_PAGE),
});
export type ReleaseBuild = z.infer<typeof ReleaseBuildSchema>;

/** The published release build from a `/api/version` body; null when absent, null or malformed. */
export function parseReleaseBuild(body: unknown): ReleaseBuild | null {
  if (!body || typeof body !== 'object') return null;
  const parsed = ReleaseBuildSchema.safeParse((body as { nativeReleaseBuild?: unknown }).nativeReleaseBuild);
  return parsed.success ? parsed.data : null;
}

/** GET /api/version (public). Resolves null on any failure: offline, non-2xx, bad body. */
export async function fetchReleaseBuild(
  baseUrl: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<ReleaseBuild | null> {
  try {
    if (!baseUrl) return null;
    const response = await fetcher(new URL('/api/version', backendOrigin(baseUrl)), {
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    return parseReleaseBuild(await response.json());
  } catch {
    return null;
  }
}

/** The real app. Preview (.preview) and development (.dev) builds never show the notice. */
export const RELEASE_APPLICATION_ID = 'com.trainingai.app';

export interface ReleaseBuildNotice {
  title: string;
  message: string;
  pageUrl: string;
}

/**
 * The "A newer build is available" notice, or null. Only in the release app, only when the
 * published version code is above the installed one; an unknown installed code ('0', the module
 * missing) says nothing rather than guess. Wording follows the current app's card
 * (components/more/update-check-card.tsx).
 */
export function releaseBuildNotice(
  applicationId: string | null,
  installed: { version: string; buildCode: string },
  build: ReleaseBuild | null,
): ReleaseBuildNotice | null {
  if (applicationId !== RELEASE_APPLICATION_ID || !build) return null;
  if (!/^[1-9]\d{0,9}$/.test(installed.buildCode)) return null;
  const installedCode = Number(installed.buildCode);
  if (build.versionCode <= installedCode) return null;
  return {
    title: 'A newer build is available',
    message: `v${build.versionName} (build ${build.versionCode}). You have v${installed.version} (build ${installedCode}). Tap to download.`,
    pageUrl: build.pageUrl,
  };
}
