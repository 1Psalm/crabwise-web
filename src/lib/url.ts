/**
 * URL safety helpers shared across features (#862, #863).
 *
 * Two jobs live here:
 *  - `safeRedirect` guards a post-login destination so it can only ever be an
 *    in-app path (open-redirect / phishing defence).
 *  - `safeExternalUrl` guards a server-supplied `href`/`src` so it can only
 *    ever be a trusted absolute URL (stored-XSS defence).
 */

/** Where an authenticated user lands when no safe destination is supplied. */
export const DEFAULT_AUTHENTICATED_PATH = '/dashboard'

/** Whitespace and control characters browsers trim or ignore inside a URL. */
// eslint-disable-next-line no-control-regex -- intentional control-character validation
const UNSAFE_REDIRECT_CHARS = /[\s\u0000-\u001f]/

/**
 * Characters browsers strip, trim or reinterpret while parsing a URL. A value
 * containing any of these is rejected outright instead of being silently
 * normalised, because the string a reviewer sees and the URL a browser
 * resolves would otherwise differ.
 */
// eslint-disable-next-line no-control-regex -- intentional control-character validation
const UNSAFE_URL_CHARS = /[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/

/**
 * Browsers treat `\` as `/` for special schemes, so `https:\\evil.com` or
 * `https://cdn.example.com\@evil.com` can read like a path while resolving to
 * a different host. There is no legitimate reason for one in an external URL.
 */
const BACKSLASH = /\\/

/**
 * A trustworthy absolute URL has a scheme followed by exactly `//` and a
 * non-empty authority. Without this, `new URL('https:///path')` quietly reads
 * `path` as the host.
 */
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\/[^/?#\\]+/i

/** Fallback origin used when `location` is unavailable (tests, SSR). */
const FALLBACK_ORIGIN = 'http://localhost'

function currentOrigin(): string {
  return typeof location !== 'undefined' && location.origin ? location.origin : FALLBACK_ORIGIN
}

/** A decoded path is only safe when it stays a single-slash-relative URL. */
function decodedIsSafe(decoded: string): boolean {
  return (
    decoded.startsWith('/') &&
    !decoded.startsWith('//') &&
    !decoded.startsWith('/\\') &&
    !UNSAFE_REDIRECT_CHARS.test(decoded)
  )
}

/**
 * A post-login destination is only safe when it is an app-relative path.
 *
 * A leading `//` (protocol-relative) or `/\` is read by browsers as an absolute
 * URL, and an encoded variant such as `/%09/` or `/%2F%2F` decodes to the same
 * thing — so the raw value is rejected early, the decoded value is checked, and
 * the resolved `URL` origin must still match the app's own origin.
 *
 * `value` is `unknown` on purpose: callers pass router state (`state.from`),
 * which is attacker-influenceable and must be narrowed rather than asserted.
 * Returns `null` instead of the default so callers can try a fallback first.
 */
function appRelativePath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return null
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    // A malformed escape sequence is not a path we can vouch for.
    return null
  }
  if (!decodedIsSafe(decoded)) return null

  const base = currentOrigin()
  let url: URL
  try {
    url = new URL(value, base)
  } catch {
    return null
  }
  // A value such as `/\evil.com` normalises to another host; origin must match.
  if (url.origin !== new URL(base).origin) return null

  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * A post-login destination is only safe when it is an app-relative path.
 * Unsafe or unusable values fall back to the authenticated home page.
 */
export function safeRedirect(value: unknown): string {
  return appRelativePath(value) ?? DEFAULT_AUTHENTICATED_PATH
}

/**
 * Resolves the post-login destination from router state and the query string,
 * using one contract everywhere: `state.from` first, then `?redirect=`, then
 * the default. Both inputs are validated at this single point of use (#862).
 */
export function resolvePostLoginRedirect(state: unknown, fallbackQuery: string | null): string {
  const from =
    typeof state === 'object' && state !== null ? (state as { from?: unknown }).from : undefined
  // An unsafe `state.from` must not win over a valid query-string fallback.
  const statePath = typeof from === 'string' ? appRelativePath(from) : null
  return statePath ?? safeRedirect(fallbackQuery)
}

/**
 * The external URL schemes we are willing to render. `https:` is always
 * required; `http:` is a development-only convenience and never accepted in a
 * production bundle.
 */
function allowedExternalProtocols(): readonly string[] {
  return import.meta.env.PROD ? ['https:'] : ['https:', 'http:']
}

/** Hostnames compare case-insensitively and without a trailing root dot. */
function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '')
}

/**
 * Validates a server-supplied external URL before it is used in `href`/`src`.
 *
 * Only `https:` is accepted in production; `http:` is additionally allowed in
 * development. `allowedHosts` optionally restricts the host (exact match,
 * case-insensitive, trailing dot ignored). Returns `null` when the URL cannot
 * be trusted, so the caller can render a fallback.
 *
 * Beyond the scheme check, this refuses input that browsers would reinterpret:
 * leading/trailing or embedded whitespace and control characters, backslashes,
 * embedded credentials (`user:pass@`, and the `trusted.example@evil.example`
 * spoof), and URLs whose normalised form disagrees with the parsed value.
 */
export function safeExternalUrl(raw: unknown, allowedHosts?: readonly string[]): string | null {
  if (typeof raw !== 'string') return null

  // `new URL` trims surrounding whitespace and silently removes tabs and
  // newlines, so `" https://…"` and `"https://exa\nmple.com"` would otherwise
  // be accepted while looking different from the URL that is actually used.
  if (raw.trim() === '' || raw !== raw.trim()) return null
  if (UNSAFE_URL_CHARS.test(raw)) return null
  if (BACKSLASH.test(raw)) return null
  if (!ABSOLUTE_URL.test(raw)) return null

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  if (!allowedExternalProtocols().includes(url.protocol)) return null

  // Credentials in an external URL are never needed by this app: they leak
  // secrets into markup and enable the `https://trusted.example@evil.example`
  // visual-spoofing trick.
  if (url.username !== '' || url.password !== '') return null

  // A relative, empty or otherwise hostless URL has no origin to trust.
  if (url.hostname === '') return null

  // Re-parse the normalised form and require it to agree with itself, so a
  // value the parser mangles cannot smuggle a different host past the checks.
  let normalized: URL
  try {
    normalized = new URL(url.toString())
  } catch {
    return null
  }
  if (normalized.protocol !== url.protocol || normalized.hostname !== url.hostname) return null

  if (allowedHosts && allowedHosts.length > 0) {
    const hostname = normalizeHostname(url.hostname)
    const permitted = allowedHosts.some(
      (host) => typeof host === 'string' && normalizeHostname(host) === hostname,
    )
    if (!permitted) return null
  }

  return url.toString()
}

/** Segments that look like an opaque token (reset tokens, JWTs, ids). */
const TOKEN_SEGMENT_PATTERN = /[A-Za-z0-9_-]{20,}/g

/**
 * Redacts token-shaped segments from a URL before it is logged, so a reset
 * token that travels in the path never reaches the console (#865).
 */
export function redactUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined
  return url.replace(TOKEN_SEGMENT_PATTERN, '[redacted]')
}
