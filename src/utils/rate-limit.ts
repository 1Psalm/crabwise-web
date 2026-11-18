/**
 * Client-side rate limiter for form submissions (#933).
 *
 * Tracks timestamps per key in memory (and optionally sessionStorage) so
 * rapid resubmits from the same browser tab are rejected before they hit
 * the network. This complements server-side limits; it is not a security
 * boundary on its own.
 *
 * The window is a sliding fixed window: only attempts that are still inside
 * `windowMs` count against `maxAttempts`. Attempts that expire are dropped
 * from both memory and storage so a new window always starts from zero.
 */

export interface RateLimitResult {
  allowed: boolean
  /** Milliseconds until the next attempt is allowed (0 when allowed). */
  retryAfterMs: number
}

export interface RateLimitOptions {
  /** Maximum attempts inside the window. */
  maxAttempts?: number
  /** Window length in milliseconds. */
  windowMs?: number
  /** Persist across reloads using sessionStorage. */
  persist?: boolean
}

const STORAGE_PREFIX = 'rl:'
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_WINDOW_MS = 60_000

const memoryStore = new Map<string, number[]>()

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Merges two stamp lists by multiplicity, so a timestamp that was recorded
 * twice (two attempts in the same millisecond) stays counted twice while the
 * in-memory and persisted copies of the same attempt are not double-counted.
 */
function mergeStamps(primary: number[], secondary: number[]): number[] {
  if (secondary.length === 0) return primary.slice()

  const primaryCounts = new Map<number, number>()
  for (const stamp of primary) {
    primaryCounts.set(stamp, (primaryCounts.get(stamp) ?? 0) + 1)
  }

  const merged = primary.slice()
  const seen = new Map<number, number>()
  for (const stamp of secondary) {
    const occurrence = seen.get(stamp) ?? 0
    seen.set(stamp, occurrence + 1)
    if (occurrence >= (primaryCounts.get(stamp) ?? 0)) merged.push(stamp)
  }
  return merged
}

function read(key: string, persist: boolean): number[] {
  const inMemory = memoryStore.get(key) ?? []

  if (!persist) return inMemory

  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${key}`)
    if (raw === null) return inMemory

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return inMemory

    // Storage can be stale or unavailable; merge so a failed write cannot
    // silently reset the counter for this tab.
    return mergeStamps(inMemory, parsed.filter(isTimestamp))
  } catch {
    // Private mode / blocked storage — the memory store still enforces limits.
    return inMemory
  }
}

function write(key: string, stamps: number[], persist: boolean): void {
  memoryStore.set(key, stamps)
  if (!persist) return
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(stamps))
  } catch {
    // Quota / private mode — memory store still works.
  }
}

/**
 * Drops attempts that are no longer inside the window and sorts the rest so
 * the oldest attempt is first. Timestamps in the future are discarded: they
 * usually mean the system clock moved backwards, and keeping them would block
 * the key until the clock caught up.
 */
function prune(stamps: number[], now: number, windowMs: number): number[] {
  return stamps.filter((stamp) => stamp <= now && now - stamp < windowMs).sort((a, b) => a - b)
}

function toMaxAttempts(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_ATTEMPTS
  return Math.max(0, Math.floor(value))
}

function toWindowMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_WINDOW_MS
  return Math.max(0, value)
}

/**
 * Returns whether an action identified by `key` is currently allowed.
 * On success the attempt is recorded against the window.
 */
export function checkRateLimit(key: string, options: RateLimitOptions = {}): RateLimitResult {
  const maxAttempts = toMaxAttempts(options.maxAttempts)
  const windowMs = toWindowMs(options.windowMs)
  const persist = options.persist ?? true
  const now = Date.now()
  const recent = prune(read(key, persist), now, windowMs)

  if (recent.length >= maxAttempts) {
    // Write the pruned window even when rejecting so expired attempts do not
    // linger in storage and leak into a later window.
    write(key, recent, persist)

    const oldest = recent[0]
    const retryAfterMs =
      oldest === undefined ? windowMs : Math.min(windowMs, Math.max(0, windowMs - (now - oldest)))
    return { allowed: false, retryAfterMs }
  }

  recent.push(now)
  write(key, recent, persist)
  return { allowed: true, retryAfterMs: 0 }
}

/** Test helper — clears all rate-limit state. */
export function resetRateLimits(): void {
  memoryStore.clear()
  try {
    const keys: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k?.startsWith(STORAGE_PREFIX)) keys.push(k)
    }
    keys.forEach((k) => sessionStorage.removeItem(k))
  } catch {
    // ignore
  }
}
