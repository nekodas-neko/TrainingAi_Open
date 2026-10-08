'use strict';
//
// #2560. Reads many source files at once, and returns them in the order asked.
//
// The source-scanning checks walk app/, components/, lib/ and packages/ — about 2,800 files — and
// read each one with `readFileSync`. A CPU profile of `check-tz-aware-cache-guards` on the owner's
// Windows machine put 1,133 of 1,516 ms in `readFileUtf8`, and the other two slow checks the same
// way (601 of 888 ms, 442 of 1,008 ms). Walking the tree took 40 ms and `statSync` on every file
// 57 ms; the cost is opening each file, one after another, on a filesystem with a real-time scanner
// in front of it. Opens that overlap hide most of that: the same 2,835 files read in ~250-450 ms
// with 32 in flight. Under a full `pnpm test`, where `check-comment-blindness` runs each check
// three times beside every other suite, the sequential version was what pushed its cases to 35-49 s.
//
// The contents are exactly what `readFileSync(p, 'utf8')` returned, in the caller's order, so a
// check that switches to this reports the same lines in the same order. A read that fails rejects,
// as `readFileSync` threw: a check must not pass over a file it could not open.

const fs = require('fs');

const IN_FLIGHT = 32;

/** `paths` read as UTF-8, in the same order. Rejects on the first read that fails. */
async function readFilesUtf8(paths) {
  const out = new Array(paths.length);
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const i = next++;
      out[i] = await fs.promises.readFile(paths[i], 'utf8');
    }
  };
  await Promise.all(Array.from({ length: Math.min(IN_FLIGHT, paths.length) }, worker));
  return out;
}

/**
 * Runs an async check body and turns a rejection into the exit a synchronous throw used to give: the
 * error printed and exit code 1. Without it an unexpected read failure would still exit non-zero on
 * current Node, but only by way of the unhandled-rejection default, which is a setting.
 */
function runMain(main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { readFilesUtf8, runMain };
