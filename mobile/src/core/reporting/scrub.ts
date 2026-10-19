// What leaves the phone in an error report (#2913): the shape of a failure, never its data.
// Tokens, keys, emails and query strings go; so do every number (a weight, a heart rate, a date)
// and every quoted phrase (a food or exercise name someone typed). The HTTP status is added back
// from the error's own field by the reporter, not read out of text.

const MAX_MESSAGE = 300;
const MAX_REASON = 80;

export function scrubText(value: string, limit = MAX_MESSAGE): string {
  return value
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[\w-]*(?:\.[\w-]*)+/g, '[token]')
    .replace(
      /\b(token|access_?token|refresh_?token|key|secret|password|authorization|cookie|code|verifier|state)\b(\s*[:=]\s*)\S+/gi,
      '$1$2[redacted]',
    )
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
    .replace(/(https?:\/\/[^\s?#]+)[?#]\S*/gi, '$1')
    .replace(/\b[\w-]{24,}\b/g, '[id]')
    .replace(/"[^"]*"|“[^”]*”|‘[^’]*’/g, '"…"')
    .replace(/(^|[^\w'])'[^']*'(?!\w)/g, '$1"…"')
    .replace(/\d+(?:[.,:]\d+)*/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

/** An `/api/` path with ids replaced and the query dropped, or undefined if it is not one. */
export function scrubApiPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const bare = path.split(/[?#]/)[0];
  if (!bare.startsWith('/api/')) return undefined;
  const scrubbed = bare
    .split('/')
    .map((segment) => (/\d/.test(segment) || segment.length > 32 ? ':id' : segment))
    .join('/')
    .replace(/[^A-Za-z0-9/_:-]/g, '')
    .slice(0, 115);
  return /^\/api\/[A-Za-z0-9/_:-]{0,110}$/.test(scrubbed) ? scrubbed : undefined;
}

export function scrubScreen(name: string | undefined): string {
  const value = name?.replace(/[^A-Za-z0-9 _:/-]/g, '').slice(0, 60);
  return value && /^[A-Za-z]/.test(value) ? value : 'App';
}

function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status < 600
    ? status
    : null;
}
function codeOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[a-z_]{1,64}$/.test(code) ? code : null;
}
/**
 * A schema failure's own message is a JSON dump of every issue. Its first issue says enough: the
 * field path (record keys can be user data, so only plain field names survive) and the code.
 */
function schemaFailure(error: unknown): string | null {
  const issues = (error as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const issue = issues[0] as { path?: unknown; code?: unknown };
  const path = Array.isArray(issue.path)
    ? issue.path
        .map((key) => (typeof key === 'string' && /^[A-Za-z_]{1,30}$/.test(key) ? key : '*'))
        .join('.')
    : '';
  const code =
    typeof issue.code === 'string' && /^[a-z_]{1,40}$/.test(issue.code) ? issue.code : 'invalid';
  return `unexpected data at ${path || 'root'} (${code})`;
}
function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'AbortError' ||
    error.name === 'TimeoutError' ||
    /network request failed|failed to fetch|network error|aborted|timed? ?out/i.test(error.message)
  );
}

/**
 * Failures that are the app working as designed: no connection, signed out, not found, a conflict,
 * the rate limit, AI paused. They still show their notice; they are not faults worth a report.
 */
export function isExpectedFailure(error: unknown): boolean {
  if (isNetworkFailure(error)) return true;
  const status = statusOf(error);
  if (status !== null && [401, 403, 404, 409, 429].includes(status)) return true;
  if (codeOf(error) === 'ai_paused') return true;
  return error instanceof Error && /^(Sign in before|The account changed)/.test(error.message);
}

/** One line for `error_events.message`: the error's kind, its scrubbed text and its HTTP status. */
export function reportMessage(error: unknown): string {
  const name = error instanceof Error ? scrubText(error.name, 40) || 'Error' : typeof error;
  const text =
    schemaFailure(error) ??
    (error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'A non-error value was thrown.');
  const status = statusOf(error);
  const code = codeOf(error);
  const http = status ? ` [HTTP ${status}${code ? ` ${code}` : ''}]` : '';
  return `${name}: ${scrubText(text) || 'no message'}${http}`.slice(0, 500);
}

/** A short reason for a notice, so a screenshot says what failed. */
export function failureReason(error: unknown): string {
  if (isNetworkFailure(error)) return 'no connection';
  const status = statusOf(error);
  if (status) return `HTTP ${status}${codeOf(error) ? ` ${codeOf(error)}` : ''}`;
  const schema = schemaFailure(error);
  if (schema) return schema;
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return scrubText(text, MAX_REASON).replace(/[.\s]+$/, '') || 'unknown error';
}
