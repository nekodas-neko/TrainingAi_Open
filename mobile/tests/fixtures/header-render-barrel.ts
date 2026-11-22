// The shared/ui barrel WorkoutLayout imports, cut down to what it uses: the real PageLayout
// (so the real PageHeader and IconButton render) plus the text and stack stand-ins.
export { AppText, Stack } from './header-render-stubs.ts';
export { PageLayout } from '../../src/shared/ui/PageLayout.tsx';
