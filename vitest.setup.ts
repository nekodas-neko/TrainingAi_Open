/**
 * Inject the vendored model constants before any test runs.
 *
 * The ports take their constants by injection rather than reading disk (Q-221, Q-545), which is
 * what keeps `node:fs` out of the Oura rollup's module graph. On the server that injection happens
 * once at boot in `instrumentation-node.ts`; under vitest there is no boot, so it happens here.
 *
 * A setup file is early enough because every port reads its constants **lazily, on first use** —
 * the module-scope reads that once made this impossible were removed for `next build`'s sake
 * (Q-49 A4b). `OURA_CONSTANTS_DIR` still has to be set in `vitest.config.ts` rather than here,
 * because that is read when this file's own imports evaluate.
 */
import { ensureServerOuraConstants } from '@/lib/oura-models/constants-inject'

ensureServerOuraConstants()
