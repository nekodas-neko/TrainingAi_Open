import { z } from 'zod';
import { appIdentityHeaders, backendOrigin } from '../../features/account/api/client.ts';

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
      headers: { Accept: 'application/json', ...appIdentityHeaders() },
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

/** The `/api/version` body (public), or null on any failure: offline, non-2xx, not JSON. */
async function fetchVersionBody(
  baseUrl: string | undefined,
  fetcher: typeof fetch,
): Promise<unknown> {
  try {
    if (!baseUrl) return null;
    const response = await fetcher(new URL('/api/version', backendOrigin(baseUrl)), {
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json', ...appIdentityHeaders() },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/** GET /api/version (public). Resolves null on any failure: offline, non-2xx, bad body. */
export async function fetchReleaseBuild(
  baseUrl: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<ReleaseBuild | null> {
  return parseReleaseBuild(await fetchVersionBody(baseUrl, fetcher));
}

// #3724. The oldest native build the server supports (`minSupportedNativeBuild`, from
// MIN_SUPPORTED_NATIVE_BUILD in packages/shared). A server from before it sends no field, and
// anything that is not a whole versionCode reads as no minimum: a false block is worse than none.
const MinimumBuildSchema = z.number().int().positive().max(2_100_000_000).nullable().catch(null);

/** The minimum supported build from a `/api/version` body; null when absent, null or malformed. */
export function parseMinimumBuild(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  return MinimumBuildSchema.parse((body as { minSupportedNativeBuild?: unknown }).minSupportedNativeBuild) ?? null;
}

/** GET /api/version (public). Resolves null (no minimum) on any failure. */
export async function fetchMinimumBuild(
  baseUrl: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<number | null> {
  return parseMinimumBuild(await fetchVersionBody(baseUrl, fetcher));
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

/** TrainingAi Preview, the side-by-side build, published to its own rolling release. */
export const PREVIEW_APPLICATION_ID = 'com.trainingai.app.preview';
const PREVIEW_PAGE = 'https://github.com/nekodas-neko/TrainingAi_Open/releases/tag/native-preview-latest';

/**
 * Where each installed build downloads its replacement: the release app from the same page as its
 * About notice (`nativeReleaseBuild.pageUrl`), Preview from its own release. Development builds
 * and the web preview have none.
 */
export function downloadPageFor(applicationId: string | null): string | null {
  if (applicationId === RELEASE_APPLICATION_ID) return RELEASE_PAGE;
  if (applicationId === PREVIEW_APPLICATION_ID) return PREVIEW_PAGE;
  return null;
}

export interface TooOldNotice {
  title: string;
  message: string;
  pageUrl: string;
}

/**
 * #3724. The blocking "too old" notice, or null. Only the release app, only below a non-null
 * minimum. An unknown installed code ('0', the module missing) says nothing rather than guess.
 *
 * The minimum is a release versionCode (2,000,000 + minor×1000 + patch, runbook "Version codes").
 * Preview counts its codes in minutes since 2026-01-01 (native-side-by-side.yml), about 450,000 in
 * Nov 2026, so any release minimum would block every Preview build. Preview is rebuilt from `main`
 * on every merge and retired a week after the switch, so it is never held to the minimum.
 */
export function tooOldNotice(
  applicationId: string | null,
  buildCode: string,
  minimum: number | null,
): TooOldNotice | null {
  if (minimum === null || applicationId !== RELEASE_APPLICATION_ID) return null;
  const pageUrl = downloadPageFor(applicationId);
  if (!pageUrl || !/^[1-9]\d{0,9}$/.test(buildCode)) return null;
  const installed = Number(buildCode);
  if (installed >= minimum) return null;
  return {
    title: 'This version of TrainingAi is too old',
    message: `The server no longer supports build ${installed}, so this app may not save or show your data correctly. Install the new build to carry on.`,
    pageUrl,
  };
}
