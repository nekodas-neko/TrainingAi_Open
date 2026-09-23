'use strict';
//
// A repo-relative path written the way the rest of this repo writes one: with forward slashes,
// on every platform.
//
// **This exists because three separate rule scripts had the same bug and none of them could fail
// on the machines that ran them** (DV-1, measured on Windows 11, 2026-09-23). Each walks the tree
// with `path.join`, which yields `app\api\x` on Windows, and then looks that up in a table whose
// keys were hand-written as `app/api/x`. The lookup misses, the allowance is not found, and the
// check reports a violation that does not exist. Three of the four `Ran 75 of 75` failures on that
// machine were this one bug wearing three names — *Sign-out wipes the device*, *An e2e stub does
// not hand the app a literal date*, and *Non-strict request schemas do not increase*.
//
// **The failure is invisible to CI, which is why it survived.** CI is Linux, where `path.sep` is
// already `/`, so every one of these scripts is correct there and always has been. It only fails
// for a human on Windows — and the Device Verification agent runs on Windows by definition, next
// to the phone. A check that cannot pass on the machine that must run it is worse than no check:
// it trains that session to treat its own gate as noise.
//
// Use `relPosix` wherever a walked absolute path becomes a KEY — a baseline lookup, an exemption
// list, a message a human will paste back. Leave `path.join`/`path.relative` alone everywhere the
// value is only ever handed back to the filesystem.

const path = require('path');

/**
 * Any path, with `\` swapped for `/`. Idempotent on a path that is already posix.
 *
 * **It replaces backslashes unconditionally rather than splitting on `path.sep`**, and the
 * difference matters. `.split(path.sep)` only normalises on the platform whose separator it sees —
 * so on Linux it silently returns a Windows path unchanged, which makes the helper untestable
 * anywhere but Windows and leaves it useless for any path that arrives from elsewhere. The first
 * draft did exactly that and its own test caught it.
 *
 * The trade is that a POSIX file whose NAME contains a literal backslash would be mangled. That is
 * legal on POSIX and absent from this repo, and these values are lookup keys for hand-written
 * tables rather than paths handed back to the filesystem — so the safer default is to treat a
 * backslash as a separator always.
 */
function toPosix(p) {
  return p.replace(/\\/g, '/');
}

/** `abs` expressed relative to `root`, always with forward slashes. */
function relPosix(root, abs) {
  return toPosix(path.relative(root, abs));
}

module.exports = { toPosix, relPosix };
