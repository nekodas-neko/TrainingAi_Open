import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = join(root, '.expo', 'dev');
const statePath = join(runtime, 'services.json');
const expoCli = join(root, 'node_modules', 'expo', 'bin', 'cli');
const receiver = join(root, 'scripts', 'receive-diagnostics.mjs');
const action = process.argv[2] ?? 'start';
const hostIndex = process.argv.indexOf('--host');
const requestedHost = hostIndex >= 0 ? process.argv[hostIndex + 1] : undefined;
mkdirSync(runtime, { recursive: true });

function powershell(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true }).trim();
}

function isPrivateAddress(address) {
  const parts = address?.split('.').map(Number) ?? [];
  return parts.length === 4 && parts.every(x => Number.isInteger(x) && x >= 0 && x <= 255)
    && (parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31));
}

function detectHost() {
  if (requestedHost) {
    if (!isPrivateAddress(requestedHost)) { throw new Error('--host must be a private LAN IPv4 address.'); }
    return requestedHost;
  }
  const output = powershell("$addresses = @(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Docker' } | Sort-Object { $_.NetIPv4Interface.InterfaceMetric } | ForEach-Object { $_.IPv4Address.IPAddress }); ConvertTo-Json -Compress -InputObject $addresses");
  const addresses = JSON.parse(output);
  const host = addresses.find(isPrivateAddress);
  if (!host) { throw new Error('No private LAN address found. Connect to your home network, or run pnpm dev -- --host YOUR_PC_IP.'); }
  return host;
}

function loadState() {
  if (!existsSync(statePath)) { return { services: [] }; }
  return JSON.parse(readFileSync(statePath, 'utf8'));
}

function ownsProcess(service) {
  if (!Number.isInteger(service.pid) || ![expoCli, receiver].includes(service.script)) { return false; }
  const output = powershell(`Get-CimInstance Win32_Process -Filter 'ProcessId = ${service.pid}' | Select-Object Name,CommandLine | ConvertTo-Json -Compress`);
  if (!output) { return false; }
  const process = JSON.parse(output);
  return process.Name?.toLowerCase() === 'node.exe' && process.CommandLine?.toLowerCase().includes(service.script.toLowerCase());
}

async function stop() {
  const state = loadState();
  let stopped = false;
  for (const service of state.services) {
    if (!ownsProcess(service)) { continue; }
    execFileSync('taskkill.exe', ['/PID', String(service.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    stopped = true;
    console.log(`Stopped ${service.name}.`);
  }
  if (stopped && state.host) {
    const deadline = Date.now() + 10000;
    while (await portOpen(state.host, 8088) || await portOpen(state.host, 8090)) {
      if (Date.now() > deadline) { throw new Error('Servers stopped but a port is still occupied. Inspect its owner before restarting.'); }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  writeFileSync(statePath, JSON.stringify({ services: [] }, null, 2));
}

async function portOpen(host, port) {
  const { createConnection } = await import('node:net');
  return new Promise(resolve => {
    const socket = createConnection({ host, port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(1000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function ready(host) {
  try {
    const response = await fetch(`http://${host}:8088/status`, { signal: AbortSignal.timeout(1500) });
    return response.ok && (await response.text()).includes('packager-status:running') && await portOpen(host, 8090);
  } catch { return false; }
}

function configure(host) {
  const path = join(root, '.env.local');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const key = existing.match(/^EXPO_PUBLIC_DEV_REPORT_KEY=(.*)$/m)?.[1].trim() || randomBytes(32).toString('hex');
  const remaining = existing.replace(/^EXPO_PUBLIC_DEV_REPORT_(URL|KEY)=.*(?:\r?\n|$)/gm, '').trimEnd();
  writeFileSync(path, `${remaining}\nEXPO_PUBLIC_DEV_REPORT_URL=http://${host}:8090/report\nEXPO_PUBLIC_DEV_REPORT_KEY=${key}\n`);
}

function launch(name, script, args, env) {
  const logPath = join(runtime, `${name}.log`);
  const log = openSync(logPath, 'a');
  const child = spawn(process.execPath, [script, ...args], { cwd: root, env, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
  closeSync(log);
  child.unref();
  return { name, script, pid: child.pid, logPath };
}

function instructions(host) {
  console.log(`\nOpen the installed TrainingAi app on your iPhone (same home network).`);
  console.log(`Select the development server, or enter: http://${host}:8088`);
  console.log('Apple Health: Health > Apple Health > Connect/Refresh Apple Health.');
  console.log('Feedback: Health > Apple Health > Send report to PC.');
  console.log(`Latest report: ${join(root, '.expo', 'diagnostics', 'latest.json')}`);
  console.log('To stop: pnpm dev:stop');
}

async function start() {
  if (!existsSync(expoCli)) { throw new Error('Dependencies are missing. Run pnpm install --frozen-lockfile in this project first.'); }
  const host = detectHost();
  const state = loadState();
  if (state.host === host && state.services.length === 2 && state.services.every(ownsProcess) && await ready(host)) {
    console.log('Development services are already running.'); instructions(host); return;
  }
  if (state.services.some(ownsProcess)) { await stop(); }
  for (const port of [8088, 8090]) {
    if (await portOpen('127.0.0.1', port) || await portOpen(host, port)) {
      throw new Error(`Port ${port} is in use by an unmanaged process. Nothing was killed. Stop that server before retrying.`);
    }
  }
  configure(host);
  const env = { ...process.env, REACT_NATIVE_PACKAGER_HOSTNAME: host };
  delete env.EXPO_PUBLIC_DEV_REPORT_URL;
  delete env.EXPO_PUBLIC_DEV_REPORT_KEY;
  const reportLog = openSync(join(runtime, 'diagnostics.log'), 'a');
  const report = spawn(process.execPath, ['--env-file=.env.local', receiver], { cwd: root, env, detached: true, windowsHide: true, stdio: ['ignore', reportLog, reportLog] });
  closeSync(reportLog); report.unref();
  const services = [{ name: 'diagnostics', script: receiver, pid: report.pid, logPath: join(runtime, 'diagnostics.log') }];
  writeFileSync(statePath, JSON.stringify({ host, services }, null, 2));
  services.push(launch('metro', expoCli, ['start', '--dev-client', '--lan', '--port', '8088'], env));
  writeFileSync(statePath, JSON.stringify({ host, services }, null, 2));
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (await ready(host)) { console.log('Expo and the report receiver are ready.'); instructions(host); return; }
    if (!services.every(ownsProcess)) { throw new Error(`A development service exited. Check logs in ${runtime}.`); }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Servers are still starting. Run pnpm dev:status and check logs in ${runtime}.`);
}

try {
  if (process.platform !== 'win32') { throw new Error('This launcher is for the current Windows development machine.'); }
  if (action === 'start') { await start(); }
  else if (action === 'restart') { await stop(); await start(); }
  else if (action === 'stop') { await stop(); console.log('Development services stopped.'); }
  else if (action === 'status') {
    const state = loadState();
    if (!state.services.length) { console.log('Development services are stopped.'); }
    for (const service of state.services) { console.log(`${service.name}: ${ownsProcess(service) ? 'running' : 'stopped'} · ${service.logPath}`); }
    if (state.host) { console.log(`iPhone server URL: http://${state.host}:8088`); }
  } else { throw new Error('Use start, stop, status or restart.'); }
} catch (error) {
  console.error(error.message); process.exitCode = 1;
}
