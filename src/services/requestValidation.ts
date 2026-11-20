/**
 * Request-boundary validation for dynamic API path parameters (#987).
 *
 * This app is a Vite SPA: it has no server routes of its own, so the last
 * place the client can prevent a malicious identifier from reaching the API is
 * the shared HTTP client. `validateRequestPath` rejects traversal, encoded
 * separators, SQL/NoSQL metacharacters and comment markers before a request is
 * sent; `checkRequestRateLimit` caps GET traffic to artist endpoints.
 *
 * Server-side validation and parameterised queries are still required — these
 * checks are defence in depth, not a replacement for backend checks.
 */

/** A conservative token allowed in a single path segment after decoding. */
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._~@:+-]{0,127}$/

/** Positive integer, never zero and never negative. */
const POSITIVE_INTEGER_ID = /^[1-9]\d*$/

/** RFC 4122 UUID (versions 1-5, variant 8/9/a/b). */
const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Artist GET endpoints are capped at this many requests per minute. */
export const ARTIST_RATE_LIMIT = { limit: 30, windowMs: 60_000 } as const

const MAX_RATE_LIMIT_BUCKETS = 500

interface RateLimitBucket {
  count: number
  resetAt: number
}

const rateLimitBuckets = new Map<string, RateLimitBucket>()

function getPathname(url: string): string | null {
  try {
    return new URL(url, 'http://lumora.invalid').pathname
  } catch {
    return null
  }
}

/**
 * Extracts the raw path without letting `URL` resolve dot segments first. A
 * literal `/../` must still be visible to the segment validator.
 */
function getRawPath(url: string): string {
  let path = url
  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.exec(url)

  if (absolute) {
    const pathStart = url.indexOf('/', absolute[0].length)
    path = pathStart === -1 ? '/' : url.slice(pathStart)
  }

  const queryStart = path.search(/[?#]/)
  return queryStart === -1 ? path : path.slice(0, queryStart)
}

/** Extracts the query string without letting `URL` normalize its contents. */
function getQueryString(url: string): string {
  let path = url
  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.exec(url)

  if (absolute) {
    const pathStart = url.indexOf('/', absolute[0].length)
    path = pathStart === -1 ? '' : url.slice(pathStart)
  }

  const queryStart = path.indexOf('?')
  if (queryStart === -1) return ''
  const hashStart = path.indexOf('#', queryStart)
  return hashStart === -1 ? path.slice(queryStart + 1) : path.slice(queryStart + 1, hashStart)
}

/** Query-string keys and values are request payloads too (#146). */
function validateQueryPayload(query: string): string | null {
  for (const pair of query.split('&').filter(Boolean)) {
    for (const part of pair.split('=')) {
      let decoded: string
      try {
        decoded = decodeURIComponent(part.replace(/\+/g, ' '))
      } catch {
        return 'Malformed URL encoding in request query.'
      }

      const issue = validatePayloadString(decoded)
      if (issue) return issue
    }
  }
  return null
}

/**
 * Returns an error message for an unsafe request path or query payload, or
 * `null` when every path segment is a safe token and the query is safe.
 */
export function validateRequestPath(url: string | undefined): string | null {
  if (!url) return null

  // Protocol-relative URLs would escape the configured API origin.
  if (url.startsWith('//')) return 'Invalid request path.'

  const rawPath = getRawPath(url)

  for (const segment of rawPath.split('/').filter(Boolean)) {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      return 'Malformed URL encoding in request path.'
    }

    if (
      decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes('\\') ||
      decoded.includes('\0')
    ) {
      return 'Invalid request path.'
    }

    if (
      !SAFE_PATH_SEGMENT.test(decoded) ||
      decoded.includes('--') ||
      decoded.includes('/*') ||
      decoded.includes('*/')
    ) {
      return 'Invalid request path parameter.'
    }
  }

  return validateQueryPayload(getQueryString(url))
}

/** True when `value` is a positive integer or a valid UUID. */
export function validateArtistId(value: string): boolean {
  const id = value.trim()
  return POSITIVE_INTEGER_ID.test(id) || UUID_ID.test(id)
}

/**
 * Validates and returns an artist id. Throws on invalid input so server route
 * handlers / API adapters can fail fast with a 400 response.
 */
export function assertValidArtistId(value: string): string {
  const id = value.trim()
  if (!validateArtistId(id)) {
    throw new Error('Invalid artist id: expected a positive integer or UUID.')
  }
  return id
}

/** True when `value` is a safe, single-segment marketplace/portfolio id. */
export function validateResourceId(value: string): boolean {
  const id = value.trim()
  return SAFE_PATH_SEGMENT.test(id) && !id.includes('--')
}

export const validateMarketplaceId = validateResourceId
export const validatePortfolioId = validateResourceId

function artistRateLimitKey(pathname: string): string | null {
  const firstSegment = pathname.split('/').filter(Boolean)[0]?.toLowerCase()
  if (firstSegment === 'profiles' || firstSegment === 'artists' || firstSegment === 'artist') {
    return firstSegment
  }
  return null
}

/**
 * Applies a fixed-window limit to `GET` requests on artist endpoints.
 *
 * Returns an error message when the limit is exceeded, otherwise `null`.
 */
export function checkRequestRateLimit(
  url: string | undefined,
  method: string | undefined,
  now = Date.now(),
): string | null {
  if (!url) return null
  if ((method ?? 'get').toLowerCase() !== 'get') return null

  const pathname = getPathname(url)
  if (!pathname) return null

  const key = artistRateLimitKey(pathname)
  if (!key) return null

  const bucket = rateLimitBuckets.get(key)
  if (!bucket || now >= bucket.resetAt) {
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + ARTIST_RATE_LIMIT.windowMs,
    })

    if (rateLimitBuckets.size > MAX_RATE_LIMIT_BUCKETS) {
      const oldest = rateLimitBuckets.keys().next().value
      if (oldest) rateLimitBuckets.delete(oldest)
    }

    return null
  }

  if (bucket.count >= ARTIST_RATE_LIMIT.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    return `Too many artist requests. Please wait ${retryAfterSeconds} second${
      retryAfterSeconds === 1 ? '' : 's'
    } and try again.`
  }

  bucket.count += 1
  return null
}

/** Clears rate-limit buckets. Intended for tests. */
export function resetRateLimitsForTests(): void {
  rateLimitBuckets.clear()
}

/**
 * Outgoing payload limits (#146). A payload that exceeds these bounds is not
 * sent: the browser would either fail to serialize it or spend an unbounded
 * amount of time walking it.
 */
export const PAYLOAD_LIMITS = {
  maxDepth: 16,
  maxStringLength: 100_000,
  maxKeys: 500,
  maxItems: 10_000,
} as const

/** Keys that can alter an object prototype when a payload is merged server-side. */
const UNSAFE_PAYLOAD_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const SCRIPT_TAG = /<\s*\/?\s*script\b/i
const ACTIVE_TAG = /<\s*\/?\s*(?:iframe|object|embed|svg|math|form)\b/i
const EVENT_HANDLER = /\bon[a-z]+\s*=/i
const SCRIPT_URL = /\b(?:javascript|vbscript)\s*:|data\s*:\s*text\/html/i
const SQL_INJECTION =
  /;\s*(?:drop|delete|update|insert|alter|truncate|create)\s+|\bunion\s+(?:all\s+)?select\b|\b(?:or|and)\s+\d+\s*=\s*\d+|'\s*(?:or|and)\b/i
const SQL_COMMENT = /--|\/\*|\*\//
const PATH_TRAVERSAL = /\.\.[/\\]/
const NOSQL_KEY = /^\$|\$\./

/** Thrown by {@link assertValidRequestPayload} when a payload is unsafe. */
export class RequestPayloadValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RequestPayloadValidationError'
  }
}

function isOpaquePayload(value: object): boolean {
  if (typeof FormData !== 'undefined' && value instanceof FormData) return true
  if (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) return true
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true
  if (value instanceof Date || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return true
  }
  return false
}

function hasUnsafeContent(value: string): boolean {
  return (
    SCRIPT_TAG.test(value) ||
    ACTIVE_TAG.test(value) ||
    EVENT_HANDLER.test(value) ||
    SCRIPT_URL.test(value) ||
    SQL_INJECTION.test(value) ||
    SQL_COMMENT.test(value) ||
    PATH_TRAVERSAL.test(value)
  )
}

function validatePayloadString(value: string): string | null {
  if (value.length > PAYLOAD_LIMITS.maxStringLength) {
    return 'Invalid request payload: a value is too long.'
  }
  if (value.includes('\0')) {
    return 'Invalid request payload: a value contains a null byte.'
  }

  if (hasUnsafeContent(value)) {
    return 'Invalid request payload: unsafe content in a value.'
  }

  // Attackers often percent-encode injection strings to slip past naive checks.
  try {
    const decoded = decodeURIComponent(value)
    if (decoded !== value && hasUnsafeContent(decoded)) {
      return 'Invalid request payload: unsafe content in a value.'
    }
  } catch {
    // A literal `%` is common in legitimate text (e.g. "10% off"); the raw
    // value was already checked above.
  }

  return null
}

function findPayloadIssue(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
): string | null {
  if (depth > PAYLOAD_LIMITS.maxDepth) {
    return 'Invalid request payload: nested too deeply.'
  }

  if (value === null || value === undefined) return null

  switch (typeof value) {
    case 'string':
      return validatePayloadString(value)
    case 'boolean':
      return null
    case 'number':
      return Number.isFinite(value) ? null : 'Invalid request payload: non-finite number.'
    case 'bigint':
    case 'function':
    case 'symbol':
      return 'Invalid request payload: value cannot be serialized.'
    case 'object':
      break
    default:
      return 'Invalid request payload: unsupported value.'
  }

  const objectValue = value as object
  if (isOpaquePayload(objectValue)) return null
  if (ancestors.has(objectValue)) return 'Invalid request payload: circular reference.'
  ancestors.add(objectValue)

  try {
    if (Array.isArray(objectValue)) {
      if (objectValue.length > PAYLOAD_LIMITS.maxItems) {
        return 'Invalid request payload: too many items.'
      }
      for (const item of objectValue) {
        const issue = findPayloadIssue(item, depth + 1, ancestors)
        if (issue) return issue
      }
      return null
    }

    const entries = Object.entries(objectValue)
    if (entries.length > PAYLOAD_LIMITS.maxKeys) {
      return 'Invalid request payload: too many fields.'
    }

    for (const [key, item] of entries) {
      if (UNSAFE_PAYLOAD_KEYS.has(key) || NOSQL_KEY.test(key)) {
        return 'Invalid request payload: unsafe field name.'
      }
      const issue = findPayloadIssue(item, depth + 1, ancestors)
      if (issue) return issue
    }
    return null
  } finally {
    ancestors.delete(objectValue)
  }
}

/**
 * Returns an error message for an unsafe outgoing payload, or `null` when the
 * payload can be sent as-is. Valid payloads are never cloned or rewritten.
 * When several values are supplied (e.g. a URL and a body) all are checked.
 */
export function validateRequestPayload(...values: unknown[]): string | null {
  for (const value of values) {
    const issue = findPayloadIssue(value, 0, new WeakSet<object>())
    if (issue) return issue
  }
  return null
}

/** Aliases for {@link validateRequestPayload} used by shorter call sites. */
export const validatePayload = validateRequestPayload
export const validateRequestBody = validateRequestPayload
export const checkRequestPayload = validateRequestPayload

/** True when a payload is safe to send. */
export function isRequestPayloadValid(payload: unknown): boolean {
  return validateRequestPayload(payload) === null
}

/** Alias for {@link isRequestPayloadValid}. */
export const isSafePayload = isRequestPayloadValid

/**
 * Validates and returns a payload unchanged. Throws before any request can be
 * sent when the payload is unsafe.
 */
export function assertValidRequestPayload<T>(payload: T): T {
  const error = validateRequestPayload(payload)
  if (error) throw new RequestPayloadValidationError(error)
  return payload
}

/** Aliases for {@link assertValidRequestPayload} used by shorter call sites. */
export const assertValidPayload = assertValidRequestPayload
export const assertValidRequestBody = assertValidRequestPayload
