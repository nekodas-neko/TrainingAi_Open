/**
 * The four banners that collapse into RV-119's strip, in the order the approved mockup draws them.
 *
 * Its own module, with no React in it, so a unit test can import the list without pulling the
 * provider's `.tsx` into the node test project.
 */
export const COLLAPSING_BANNERS = ['exerciseDetected', 'goalsCheckin', 'dayReview', 'weeklyRecap'] as const
export type CollapsingBanner = typeof COLLAPSING_BANNERS[number]
