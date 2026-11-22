export * from '@trainingai/shared/coach/patch';

/**
 * #3896 step 5: the gated patch domains this build's ChangeCard renders. Sent with every chat request;
 * the server offers a gated domain only to a build that names it (`withClientDomains`).
 */
export const RENDERED_PATCH_DOMAINS = ['lift_preference'] as const;
