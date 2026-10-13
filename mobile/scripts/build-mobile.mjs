import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  prepareSharedSnapshot,
  clearSharedSnapshot,
} from '../src/development/build/shared-package.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const { expo } = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8'));
const buildsUrl = `https://expo.dev/accounts/${encodeURIComponent(expo.owner)}/projects/${encodeURIComponent(expo.slug)}/builds`;
function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}
const platform = option('--platform', 'ios');
const profile = option('--profile', 'development');
if (
  !['ios', 'android'].includes(platform) ||
  !['development', 'preview', 'production'].includes(profile)
) {
  throw new Error('Use --platform ios|android and --profile development|preview|production.');
}
const easProfile = platform === 'android' ? `android-${profile}` : profile;
const easVersion = '24.13.0';
const interactive = process.argv.includes('--interactive');
const command =
  `npx.cmd --yes eas-cli@${easVersion} build --platform ${platform} --profile ${easProfile} --wait` +
  (interactive ? '' : ' --non-interactive --freeze-credentials');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      ...options,
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

async function build() {
  if (platform === 'android') {
    if (!existsSync(resolve(root, 'credentials.json')))
      throw new Error(
        'Android builds require the existing signing key configured in credentials.json.',
      );
    const credentials = JSON.parse(readFileSync(resolve(root, 'credentials.json'), 'utf8'));
    const keystore = credentials.android?.keystore?.keystorePath;
    if (!keystore || !readFileSync(resolve(root, keystore)).length) {
      throw new Error(
        'Configure the existing Android signing key in credentials.json before building.',
      );
    }
  }
  console.info(`Building the ${platform} ${profile} app. This can take several minutes.`);
  console.info(
    interactive
      ? 'Expo signing setup prompts are enabled.'
      : 'Using saved signing credentials without setup prompts.',
  );
  console.info(`Build downloads: ${buildsUrl}`);
  prepareSharedSnapshot(root);
  let result;
  try {
    const args = [
      '--yes',
      `eas-cli@${easVersion}`,
      'build',
      '--platform',
      platform,
      '--profile',
      easProfile,
      '--wait',
      ...(interactive ? [] : ['--non-interactive', '--freeze-credentials']),
    ];
    result = await run(
      process.platform === 'win32' ? 'cmd.exe' : 'npx',
      process.platform === 'win32' ? ['/d', '/c', command] : args,
      { env: { ...process.env, EAS_NO_VCS: '1', EAS_PROJECT_ROOT: root } },
    );
  } finally {
    clearSharedSnapshot(root);
  }
  if (result !== 0) {
    process.exitCode = result;
    return;
  }

  console.info(`Build finished: ${buildsUrl}`);
  console.info('Choose the matching platform and profile on the builds page.');
  if (process.platform === 'win32' && !process.env.CI && !process.argv.includes('--no-open')) {
    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', buildsUrl], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    browser.on('error', () => console.info('Open the builds page using the link above.'));
    browser.unref();
  }

  if (process.platform !== 'win32' || process.env.CI || profile !== 'development') return;
  try {
    const development = await run(
      process.execPath,
      [resolve(root, 'scripts/dev.mjs'), 'start'],
      { windowsHide: true },
    );
    if (development !== 0) {
      console.info(
        'The build is ready, but the development server needs attention. Use Start Development.cmd.',
      );
    }
  } catch (error) {
    console.info(
      `The build is ready, but the development server could not start: ${error.message}`,
    );
  }
}

if (process.argv.includes('--check')) {
  console.info(
    JSON.stringify(
      {
        root,
        platform,
        profile: easProfile,
        command,
        buildsUrl,
        androidPackage:
          platform === 'android'
            ? profile === 'development'
              ? 'com.trainingai.app.dev'
              : 'com.trainingai.app'
            : null,
        startDevelopmentAfterBuild: profile === 'development',
      },
      null,
      2,
    ),
  );
} else {
  build().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
