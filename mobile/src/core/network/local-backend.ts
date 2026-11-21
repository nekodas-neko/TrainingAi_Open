/**
 * #3761. Whether a plain-http local server may be the backend. Every build keeps the https rule
 * except the browser preview's development export, whose adapter (`integrations/auth/web-preview.ts`)
 * is the one caller of `allowLocalHttpBackend`. No Android or iOS bundle and no production web
 * export contains that adapter (`tests/web-preview-guard.test.ts`).
 */
let allowed = false;
export function allowLocalHttpBackend() {
  allowed = true;
}
/** True only once allowed, and only for http://localhost or http://127.0.0.1 on any port. */
export function isAllowedLocalHttp(url: URL) {
  return allowed && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
}
