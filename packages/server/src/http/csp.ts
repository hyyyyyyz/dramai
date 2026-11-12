/**
 * Content-Security-Policy for the HTML shell of the hosted frontend (the SPA's index.html).
 *
 * Each directive lists only what the built app really needs (checked against the actual build by
 * `test/csp.test.ts`, which also loads it in a real browser when one is available):
 *
 * | directive         | why |
 * | ----------------- | --- |
 * | default-src       | everything else is same-origin only |
 * | script-src        | the bundle, its chunks and `theme-init.js` — all same-origin files. No inline scripts, no eval |
 * | style-src         | the bundled CSS; `'unsafe-inline'` because UI libraries set `style` attributes and inject small style rules |
 * | font-src          | self-hosted font files (`/assets/*.woff2`) and small fonts the bundler inlines as `data:` URLs |
 * | img-src           | project images through the file route (same-origin), inline `data:` icons, `blob:` previews of local uploads |
 * | media-src         | project videos / audio (same-origin, Range requests), `blob:` previews |
 * | connect-src       | the HTTP API and the SSE stream — same-origin only (the server sends no CORS headers anyway) |
 * | object-src        | no plugins |
 * | base-uri          | nobody may re-base relative URLs |
 * | form-action       | forms can only submit to this origin |
 * | frame-ancestors   | the app cannot be embedded (also `X-Frame-Options: DENY`) |
 */
export const APP_CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'font-src': ["'self'", 'data:'],
  'img-src': ["'self'", 'data:', 'blob:'],
  'media-src': ["'self'", 'blob:'],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
} as const satisfies Record<string, readonly string[]>

export const APP_CSP = Object.entries(APP_CSP_DIRECTIVES)
  .map(([name, sources]) => `${name} ${sources.join(' ')}`)
  .join('; ')
