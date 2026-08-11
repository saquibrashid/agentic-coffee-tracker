/**
 * The styling every text-entry control shares.
 *
 * Kept in one place because the alternative — the class string repeated at
 * each call site — is what this file exists to delete. There were nine copies
 * of it across the app, and they had already drifted: some carried a focus
 * ring, some did not.
 *
 * Height is 44px (`h-11`), not the 40px the copies used. `specs/ux-states.md`
 * requires a 44px minimum touch target and every hand-styled control in the
 * app was 4px under it.
 */
export const controlBase =
  'flex w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50';

/** Fixed-height controls. Textareas grow, so they opt out. */
export const controlHeight = 'h-11';
