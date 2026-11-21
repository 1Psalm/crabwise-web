import { afterEach, describe, expect, it, vi } from 'vitest'
import { analytics } from './analytics'
import type { AnalyticsEvent, AnalyticsProps } from './analytics'

// ---------------------------------------------------------------------------
// #865 closed the gaps this file used to pin. The scrubber now:
//  1. matches Stellar addresses in any casing, muxed (`M…`) addresses included;
//  2. walks nested objects/arrays, so an email under an unrecognised key is
//     stripped instead of forwarded whole;
//  3. drops anything shaped like a token, even under a neutral key name.
// ---------------------------------------------------------------------------

/**
 * Tests for the PII scrubber that runs on every analytics event
 * (`stripPii`, exercised here only through the public `analytics.track` API).
 *
 * The goal is that personal or sensitive data (wallet addresses, emails,
 * tokens) never reaches the analytics provider, whatever key it is stored
 * under and however deeply it is nested. Only clearly harmless values
 * (titles, counts, flags) should pass through.
 */

/**
 * Sends `props` through `analytics.track` and returns what the provider
 * actually received, i.e. the properties AFTER scrubbing.
 *
 * How it works:
 *  - installs a mock provider whose `track` is a spy,
 *  - tracks an arbitrary event (`artwork_view`) with the given props,
 *  - removes the provider again so no state leaks into other tests,
 *  - asserts the provider was called exactly once and returns its second
 *    argument (the cleaned props).
 *
 * `satisfies AnalyticsEvent` checks at compile time that the event name is
 * valid without widening its literal type.
 */
function trackWithCapture(props: AnalyticsProps): AnalyticsProps {
  const track = vi.fn()
  analytics.setProvider({ track })
  analytics.track('artwork_view' satisfies AnalyticsEvent, props)
  analytics.setProvider(null)
  expect(track).toHaveBeenCalledTimes(1)
  return track.mock.calls[0]?.[1] as AnalyticsProps
}

/**
 * Builds a fake 56-character Stellar public key: a one-character prefix
 * (`G` for a normal account, `M` used here to mimic muxed-style input)
 * followed by 55 filler base32 characters.
 *
 * `casing` lets tests check that matching is case-insensitive, since
 * lowercase addresses must be caught too.
 *
 * The value is not a valid key (no checksum); it only has the right shape.
 */
/** 56-char Stellar public key: G/M + 55 base32 characters. */
function stellarAddress(prefix: string, casing: 'upper' | 'lower' = 'upper'): string {
  const body = 'a'.repeat(55)
  return prefix + (casing === 'upper' ? body.toUpperCase() : body)
}

/**
 * Builds a fake 69-character muxed account: `M` + 68 filler base32 characters.
 * Muxed accounts are longer than plain `G…` keys, so they need their own
 * pattern in the scrubber and their own test input.
 */
/** A 69-char muxed account: M + 68 base32 characters. */
function muxedAddress(): string {
  return 'M' + 'b'.repeat(68)
}

// NOTE: `stellarAddress` is declared a second time below with an identical
// body (likely a copy-paste slip). Duplicate function declarations in one
// scope are a TypeScript error ("Duplicate function implementation"), so one
// of the two copies should be deleted. It is left in place here to keep this
// change comment-only.
/** 56-char Stellar public key: G/M + 55 base32 characters. */
function stellarAddress(prefix: string, casing: 'upper' | 'lower' = 'upper'): string {
  const body = 'a'.repeat(55)
  return prefix + (casing === 'upper' ? body.toUpperCase() : body)
}

describe('stripPii (via analytics.track)', () => {
  afterEach(() => {
    // Safety net: if a test fails before trackWithCapture removes its mock
    // provider, make sure it does not leak into the next test.
    analytics.setProvider(null)
    vi.restoreAllMocks()
  })

  // --- Stellar addresses -----------------------------------------------------
  // A wallet address can identify a person on a public ledger, so it must be
  // removed even when it is buried inside free text under a harmless key
  // like `note`. The whole entry is dropped, not just the address substring.

  it('strips an uppercase Stellar address stored under a neutral key', () => {
    const props = trackWithCapture({ note: `sent to ${stellarAddress('G')}` })
    // Empty object: the only property contained an address, so it is removed.
    expect(props).toEqual({})
  })

  it('strips a muxed M… address', () => {
    // A 56-char string starting with `M`, covering the muxed prefix.
    const props = trackWithCapture({ note: `route ${stellarAddress('M')}` })
    expect(props).toEqual({})
  })

  it('strips a lowercase Stellar address', () => {
    // Matching must be case-insensitive; users and tools often lowercase keys.
    expect(trackWithCapture({ note: `sent to ${stellarAddress('g', 'lower')}` })).toEqual({})
  })

  it('strips a 69-character muxed address', () => {
    // The full-length muxed form (M + 68 chars) is longer than a plain key
    // and must also be recognised.
    expect(trackWithCapture({ note: `route ${muxedAddress()}` })).toEqual({})
  })

  // --- Nested data -----------------------------------------------------------

  it('strips an email nested under an unrecognised key', () => {
    // Neither `context`, `buyer` nor `events` is a known PII key, so the
    // scrubber has to inspect values recursively, through objects and arrays.
    const nested = {
      context: { buyer: 'ada@example.com', viewport: 'mobile' },
      events: ['first-view', 'ada@example.com'],
    }
    // Only the offending leaf values are removed; the surrounding structure
    // and the harmless values ('mobile', 'first-view') are kept.
    // The cast is needed because AnalyticsProps likely forbids nested values
    // at the type level, but runtime callers could still pass them.
    expect(trackWithCapture(nested as unknown as AnalyticsProps)).toEqual({
      context: { viewport: 'mobile' },
      events: ['first-view'],
    })
  })

  // --- Tokens ----------------------------------------------------------------

  it('strips a token-shaped value even under a neutral key', () => {
    // Looks like a JWT: three dot-separated base64url segments, the first
    // starting with `eyJ`. The scrubber should catch it by shape, so a
    // credential cannot slip through just because it is stored under `note`.
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(trackWithCapture({ note: jwt })).toEqual({})
  })

  // --- Emails and PII keys ---------------------------------------------------

  it('strips an email address from a string value', () => {
    // The email is embedded in a sentence; the entire value is dropped
    // rather than partially redacted.
    const props = trackWithCapture({ message: 'contact ada@example.com for details' })
    expect(props).toEqual({})
  })

  it('strips entries whose key names a PII field', () => {
    // These values ('anything') do not look sensitive; they are removed
    // purely because the key names (`userEmail`, `walletAddress`) say PII.
    const props = trackWithCapture({ userEmail: 'anything', walletAddress: 'anything' })
    expect(props).toEqual({})
  })

  it('keeps a PII-keyed entry dropped rather than inferring from the value', () => {
    // A credential is dropped on the strength of its key alone, so a value that
    // happens not to look sensitive still never leaves the app (#865).
    // Here the key `walletLinked` contains "wallet", and its value is just a
    // boolean, yet it is still removed. This pins the (deliberately strict)
    // key-based behaviour: the scrubber errs on the side of dropping data.
    const props = trackWithCapture({ walletLinked: true })
    expect(props).toEqual({})
  })

  // --- Control case ----------------------------------------------------------

  it('preserves non-sensitive values under clean keys', () => {
    // Guards against over-scrubbing: ordinary strings, numbers and booleans
    // under harmless keys must pass through untouched, otherwise analytics
    // would lose useful data.
    const props = trackWithCapture({ title: 'Sunset over Lagos', views: 12, featured: true })
    expect(props).toEqual({ title: 'Sunset over Lagos', views: 12, featured: true })
  })
})
