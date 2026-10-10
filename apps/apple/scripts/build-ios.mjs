import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const child = spawn('cmd.exe', ['/d', '/c', 'npx.cmd --yes eas-cli@latest build --platform ios --profile development'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, EAS_NO_VCS: '1', EAS_PROJECT_ROOT: root },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
