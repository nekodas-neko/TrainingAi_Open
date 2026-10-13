import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const endpoint = new URL(process.env.EXPO_PUBLIC_DEV_REPORT_URL);
const key = process.env.EXPO_PUBLIC_DEV_REPORT_KEY;
if (!key || key.length < 32) { throw new Error('Configure the local development report key first.'); }
const parts = endpoint.hostname.split('.').map(Number);
if (endpoint.protocol !== 'http:' || endpoint.pathname !== '/report' || parts.length !== 4
  || !parts.every(x => Number.isInteger(x) && x >= 0 && x <= 255)
  || !(parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31))) {
  throw new Error('The receiver must bind to a private LAN address.');
}
const reportDirectory = new URL('../.expo/diagnostics/', import.meta.url);
await mkdir(reportDirectory, { recursive: true });
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const reply = status => { response.writeHead(status); response.end(); };
  if (request.url !== '/report') { reply(404); return; }
  if (request.method !== 'POST') { reply(405); return; }
  const provided = Buffer.from(request.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${key}`);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) { reply(401); return; }
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') { reply(415); return; }
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > 256 * 1024) { reply(413); return; }
      chunks.push(chunk);
    }
    let report;
    try { report = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { reply(400); return; }
    if (!report || report.reportVersion !== 1 || report.platform !== 'ios'
      || typeof report.capturedAt !== 'string' || !Number.isFinite(Date.parse(report.capturedAt))
      || !['Today', 'Data', 'Settings'].includes(report.screen)
      || !(report.error === null || typeof report.error === 'string')
      || !(report.snapshot === null || (['device', 'sample'].includes(report.snapshot?.mode)
        && Array.isArray(report.snapshot.metrics) && report.snapshot.metrics.length <= 50
        && (!report.snapshot.inspection || (Array.isArray(report.snapshot.inspection.entries) && report.snapshot.inspection.entries.length <= 50))))) {
      reply(400); return;
    }
    await writeFile(new URL('latest.json', reportDirectory), `${JSON.stringify({ ...report, receivedAt: new Date().toISOString() }, null, 2)}\n`);
    console.log(`Received report at ${new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane' })} · ${report.screen}`);
    reply(202);
  } catch {
    console.error('Could not receive or save the development report.');
    if (!response.headersSent) { reply(500); }
  }
});
server.requestTimeout = 15000;
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(Number(endpoint.port || 80), endpoint.hostname, () => {
  console.log(`Local development report receiver: ${endpoint.origin}/report`);
  console.log(`Latest report: ${fileURLToPath(new URL('latest.json', reportDirectory))}`);
});
