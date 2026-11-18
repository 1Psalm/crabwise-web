import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { checkRateLimit, resetRateLimits } from './rate-limit'

const BASE = 1_700_000_000_000
const WINDOW_MS = 1_000

function stored(key: string): unknown {
  return JSON.parse(sessionStorage.getItem(`rl:${key}`) ?? 'null')
}

describe('checkRateLimit (#151)', () => {
  beforeEach(() => {
    resetRateLimits()
    vi.useFakeTimers()
    vi.setSystemTime(BASE)
  })

  afterEach(() => {
    resetRateLimits()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('blocks requests inside the window and allows them once it expires', () => {
    const options = { maxAttempts: 3, windowMs: WINDOW_MS, persist: false }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(checkRateLimit('form', options).allowed).toBe(true)
    }

    const blocked = checkRateLimit('form', options)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBe(WINDOW_MS)

    // One millisecond before expiry the key is still blocked, with an accurate
    // remaining time rather than a full window.
    vi.advanceTimersByTime(WINDOW_MS - 1)
    const stillBlocked = checkRateLimit('form', options)
    expect(stillBlocked.allowed).toBe(false)
    expect(stillBlocked.retryAfterMs).toBe(1)

    // The boundary itself is expired: `now - stamp === windowMs`.
    vi.advanceTimersByTime(1)
    expect(checkRateLimit('form', options)).toEqual({ allowed: true, retryAfterMs: 0 })
  })

  it('resets the counter after expiry without carrying old attempts forward', () => {
    const options = { maxAttempts: 2, windowMs: WINDOW_MS, persist: false }

    expect(checkRateLimit('form', options).allowed).toBe(true)
    expect(checkRateLimit('form', options).allowed).toBe(true)
    expect(checkRateLimit('form', options).allowed).toBe(false)

    vi.advanceTimersByTime(WINDOW_MS)

    // A fresh window grants the full allowance, not just one slot.
    expect(checkRateLimit('form', options).allowed).toBe(true)
    expect(checkRateLimit('form', options).allowed).toBe(true)
    expect(checkRateLimit('form', options).allowed).toBe(false)
  })

  it('prunes expired timestamps from sessionStorage instead of leaking them', () => {
    const options = { maxAttempts: 3, windowMs: WINDOW_MS }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(checkRateLimit('persisted', options).allowed).toBe(true)
    }
    expect(stored('persisted')).toEqual([BASE, BASE, BASE])

    vi.advanceTimersByTime(WINDOW_MS)

    expect(checkRateLimit('persisted', options).allowed).toBe(true)
    expect(stored('persisted')).toEqual([BASE + WINDOW_MS])
  })

  it('keeps timestamps sorted so retryAfterMs is based on the oldest attempt', () => {
    const options = { maxAttempts: 2, windowMs: WINDOW_MS, persist: false }

    expect(checkRateLimit('mixed', options).allowed).toBe(true)
    vi.advanceTimersByTime(400)
    expect(checkRateLimit('mixed', options).allowed).toBe(true)

    const blocked = checkRateLimit('mixed', options)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBe(600)
  })

  it('does not store future timestamps that would lock a key after a clock change', () => {
    const options = { maxAttempts: 1, windowMs: WINDOW_MS }
    sessionStorage.setItem('rl:skewed', JSON.stringify([BASE + WINDOW_MS]))

    expect(checkRateLimit('skewed', options).allowed).toBe(true)
    expect(stored('skewed')).toEqual([BASE])
  })

  it('falls back to memory when sessionStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('storage disabled', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('storage disabled', 'SecurityError')
    })

    const options = { maxAttempts: 2, windowMs: WINDOW_MS }
    expect(checkRateLimit('blocked-storage', options).allowed).toBe(true)
    expect(checkRateLimit('blocked-storage', options).allowed).toBe(true)

    const blocked = checkRateLimit('blocked-storage', options)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBe(WINDOW_MS)

    vi.advanceTimersByTime(WINDOW_MS)
    expect(checkRateLimit('blocked-storage', options).allowed).toBe(true)
  })

  it('treats unreadable persisted data as empty rather than resetting the memory counter', () => {
    sessionStorage.setItem('rl:corrupt', '{not-json')
    const options = { maxAttempts: 1, windowMs: WINDOW_MS }

    expect(checkRateLimit('corrupt', options).allowed).toBe(true)
    expect(checkRateLimit('corrupt', options).allowed).toBe(false)
    expect(stored('corrupt')).toEqual([BASE])
  })

  it('keeps counters isolated per key', () => {
    const options = { maxAttempts: 1, windowMs: WINDOW_MS, persist: false }

    expect(checkRateLimit('first', options).allowed).toBe(true)
    expect(checkRateLimit('first', options).allowed).toBe(false)
    expect(checkRateLimit('second', options).allowed).toBe(true)
  })

  it('does not write to sessionStorage when persistence is disabled', () => {
    expect(checkRateLimit('memory-only', { maxAttempts: 1, persist: false }).allowed).toBe(true)
    expect(sessionStorage.getItem('rl:memory-only')).toBeNull()
  })

  it('can clear persisted counters so the next window starts clean', () => {
    const options = { maxAttempts: 1, windowMs: WINDOW_MS }

    expect(checkRateLimit('reset-me', options).allowed).toBe(true)
    expect(checkRateLimit('reset-me', options).allowed).toBe(false)

    resetRateLimits()

    expect(checkRateLimit('reset-me', options).allowed).toBe(true)
  })
})
