/*
 * Intentionally a no-op.
 *
 * This swagger-ui build already ships a native dark-mode system: it adds the
 * `html.dark-mode` class (via its built-in toggle button and the OS
 * prefers-color-scheme setting). cw-swagger.css recolors that native light/dark
 * theme with the CWUI palette.
 *
 * A previous version of this file ran a SECOND, parallel theme toggle that added
 * a `.cw-swagger-dark` class. Having two independent dark-mode systems meant that
 * when the saved choice and the OS preference disagreed, swagger's dark
 * background and the light text overrode each other — producing an unreadable
 * dark-on-dark page. Keeping this file empty leaves swagger's native dark mode as
 * the single source of truth.
 */
