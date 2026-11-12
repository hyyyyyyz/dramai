import { z } from 'zod'

/**
 * Zod 4 probes for `new Function('')` the first time it builds an object schema, to decide whether it can
 * compile a fast path. In a page served with a strict Content-Security-Policy (no `'unsafe-eval'`, which the
 * app must not allow) that probe is blocked: harmless — zod falls back — but the browser reports it as a CSP
 * violation. So when running in a browser, turn the JIT off up front. On the server (Node) it stays on.
 *
 * Must run before any schema is created, which is why `schemas.ts` imports this file first.
 */
// `globalThis` checks instead of `window` / `document`: this file is also compiled by packages without DOM typings.
if ('window' in globalThis && 'document' in globalThis) {
  z.config({ jitless: true })
}
