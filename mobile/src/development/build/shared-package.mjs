import {
  cpSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { resolve, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ownRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
function snapshotDirectory(root) {
  const target = resolve(root, '.eas-vendor');
  if (relative(root, target) !== '.eas-vendor') {
    throw new Error('Invalid build snapshot path.');
  }
  return target;
}
function validateShared(directory) {
  const value = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  if (value.name !== '@trainingai/shared' || !existsSync(resolve(directory, 'src'))) {
    throw new Error('The shared source package is unavailable.');
  }
}
export function prepareSharedSnapshot(root) {
  const source = resolve(root, '../packages/shared');
  validateShared(source);
  const vendor = snapshotDirectory(root);
  if (existsSync(vendor)) {
    rmSync(vendor, { recursive: true, force: true });
  }
  const target = resolve(vendor, 'shared');
  mkdirSync(target, { recursive: true });
  copyFileSync(resolve(source, 'package.json'), resolve(target, 'package.json'));
  cpSync(resolve(source, 'src'), resolve(target, 'src'), {
    recursive: true,
    filter: (path) => {
      const parts = relative(source, path).split(sep);
      return (
        !lstatSync(path).isSymbolicLink() &&
        !parts.some(
          (part) =>
            part.startsWith('.') ||
            part === '__tests__' ||
            part === 'node_modules' ||
            /\.test\.[cm]?[jt]sx?$/.test(part),
        )
      );
    },
  });
  validateShared(target);
  return target;
}
export function restoreSharedSnapshot(root) {
  const target = resolve(root, '../packages/shared');
  if (existsSync(target)) {
    validateShared(target);
    return target;
  }
  const source = resolve(snapshotDirectory(root), 'shared');
  validateShared(source);
  mkdirSync(target, { recursive: true });
  copyFileSync(resolve(source, 'package.json'), resolve(target, 'package.json'));
  cpSync(resolve(source, 'src'), resolve(target, 'src'), { recursive: true });
  return target;
}
export function clearSharedSnapshot(root) {
  const target = snapshotDirectory(root);
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'prepare') {
    prepareSharedSnapshot(ownRoot);
    console.log('Shared source prepared for the app-only iPhone archive.');
  } else if (process.argv[2] === 'restore' && process.env.EAS_BUILD === 'true') {
    restoreSharedSnapshot(ownRoot);
    console.log('Shared source restored before dependency installation.');
  }
}
