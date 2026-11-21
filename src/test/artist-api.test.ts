import { beforeEach, describe, expect, it } from 'vitest'
import {
  artistIdSchema,
  hasPathTraversal,
  hasSqlInjection,
  marketplaceIdSchema,
  portfolioIdSchema,
  validateArtistId,
  validateMarketplaceId,
  validatePortfolioId,
} from '@/validators/artist-id.validator'
import {
  ARTIST_ROUTE_LIMIT,
  GET as artistGet,
  default as artistHandler,
  resetArtistApiRateLimits,
} from '@/api/artist/[id]'
import { GET as marketplaceGet, default as marketplaceHandler } from '@/api/marketplace/[id]'
import { GET as portfolioGet, default as portfolioHandler } from '@/api/portfolio/[id]'

/**
 * Tests for ID validation (#940) at two levels:
 *
 *  1. The validator module (`artist-id.validator`): pure functions and zod
 *     schemas that decide whether a route `id` is acceptable.
 *  2. The route handlers (`api/artist`, `api/marketplace`, `api/portfolio`):
 *     they must call the validator, answer 400 for bad IDs, and (for artist)
 *     apply rate limiting.
 *
 * Each handler is exercised through both supported interfaces:
 *  - the App Router style `GET(request, { params })`, which returns a
 *    standard `Response`, and
 *  - the Pages Router / Express style `default(req, res)`, which writes to a
 *    response object with `status()` and `json()`.
 */

describe('artist-id validator (#940)', () => {
  it('accepts valid positive integers', () => {
    // Numeric IDs are accepted as strings (route params are always strings).
    expect(validateArtistId('1').success).toBe(true)
    expect(validateArtistId('42').success).toBe(true)
    expect(validateArtistId('99999').success).toBe(true)
    // `parse` returns the value unchanged (still a string, not a number).
    expect(artistIdSchema.parse('42')).toBe('42')
  })

  it('accepts valid UUIDs', () => {
    // An artist ID may be either a positive integer or a UUID.
    const validUuid = '123e4567-e89b-12d3-a456-426614174000'
    expect(validateArtistId(validUuid).success).toBe(true)
    expect(artistIdSchema.parse(validUuid)).toBe(validUuid)
  })

  it('rejects zero, negative integers, and decimals', () => {
    // Only strictly positive whole numbers are valid IDs.
    expect(validateArtistId('0').success).toBe(false)
    expect(validateArtistId('-1').success).toBe(false)
    expect(validateArtistId('-42').success).toBe(false)
    expect(validateArtistId('3.14').success).toBe(false)
    // An empty string is also invalid.
    expect(validateArtistId('').success).toBe(false)
  })

  it('blocks path traversal attempts', () => {
    // The detector should flag several encodings of "go up a directory":
    expect(hasPathTraversal('../../etc/passwd')).toBe(true) // plain
    expect(hasPathTraversal('..%2f..%2fetc%2fpasswd')).toBe(true) // URL-encoded slash
    expect(hasPathTraversal('..\\..\\windows')).toBe(true) // Windows backslashes
    // A plain path separator is rejected too, since an ID never needs one.
    expect(hasPathTraversal('artist/42')).toBe(true)
    // A null byte can truncate paths in some systems, so it is blocked.
    expect(hasPathTraversal('42\0')).toBe(true)

    // validateArtistId should surface this as a failure with a clear reason.
    const result = validateArtistId('../../etc/passwd')
    expect(result.success).toBe(false)
    // The `if` narrows the union type so `result.error` is accessible.
    if (!result.success) {
      expect(result.error).toMatch(/path traversal/i)
    }
  })

  it('blocks SQL injection attempts', () => {
    // Common injection shapes: boolean tautology, statement chaining,
    // trailing comment, inline comment, and UNION-based extraction.
    expect(hasSqlInjection("1' OR '1'='1")).toBe(true)
    expect(hasSqlInjection('1; DROP TABLE users')).toBe(true)
    expect(hasSqlInjection('1--')).toBe(true)
    expect(hasSqlInjection('1/*comment*/')).toBe(true)
    expect(hasSqlInjection("1' UNION SELECT * FROM users--")).toBe(true)

    const result = validateArtistId("1' OR '1'='1")
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toMatch(/sql injection/i)
    }
  })

  it('validates marketplace and portfolio IDs', () => {
    // Marketplace IDs may be numeric or slug-like (e.g. "listing-123").
    expect(validateMarketplaceId('42').success).toBe(true)
    expect(validateMarketplaceId('listing-123').success).toBe(true)
    expect(marketplaceIdSchema.parse('listing-123')).toBe('listing-123')
    // The same injection and traversal protections apply.
    expect(validateMarketplaceId('../etc/passwd').success).toBe(false)
    expect(validateMarketplaceId("1' OR '1'='1").success).toBe(false)

    // Portfolio IDs follow the same idea (e.g. "artwork-99").
    expect(validatePortfolioId('artwork-99').success).toBe(true)
    expect(portfolioIdSchema.parse('artwork-99')).toBe('artwork-99')
    expect(validatePortfolioId('../../passwd').success).toBe(false)
    expect(validatePortfolioId('1; DROP TABLE').success).toBe(false)
  })
})

describe('api/artist/[id].tsx route handler (#940)', () => {
  beforeEach(() => {
    // The artist route keeps in-memory rate-limit counters. Clearing them
    // before every test stops requests in one test from counting toward
    // another test's limit (important for the rate-limit test below).
    resetArtistApiRateLimits()
  })

  it('returns 200 with artist data for valid positive integer ID', async () => {
    // The handler only reads `params`, so an empty object cast to Request is
    // enough as the first argument in these tests.
    const response = await artistGet({} as Request, { params: { id: '42' } })
    expect(response.status).toBe(200)
    const data = await response.json()
    // `toMatchObject` checks only the listed fields, ignoring any others.
    expect(data).toMatchObject({ id: '42', verified: true })
  })

  it('returns 200 with artist data for valid UUID', async () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000'
    const response = await artistGet({} as Request, { params: { id: uuid } })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({ id: uuid, verified: true })
  })

  it('returns 400 Bad Request with clear error message for invalid ID format', async () => {
    // A plain non-numeric, non-UUID string fails format validation.
    const response = await artistGet({} as Request, { params: { id: 'invalid-string' } })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Bad Request')
    // The message tells the caller which formats are allowed.
    expect(data.message).toMatch(/positive integer or uuid/i)
  })

  it('returns 400 Bad Request and blocks path traversal attempts', async () => {
    // URL-encoded traversal, as it could arrive from a raw request path.
    const response = await artistGet({} as Request, {
      params: { id: '..%2f..%2fetc%2fpasswd' },
    })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Bad Request')
    // The specific reason is reported, not just a generic format error.
    expect(data.message).toMatch(/path traversal/i)
  })

  it('returns 400 Bad Request and blocks SQL injection attempts', async () => {
    const response = await artistGet({} as Request, {
      params: { id: "1' OR '1'='1" },
    })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Bad Request')
    expect(data.message).toMatch(/sql injection/i)
  })

  it('enforces rate limiting on artist API endpoint', async () => {
    // Exhaust requests up to limit
    // Every request up to the configured maximum must still succeed...
    for (let i = 0; i < ARTIST_ROUTE_LIMIT.maxRequests; i++) {
      const res = await artistGet({} as Request, { params: { id: '42' } })
      expect(res.status).toBe(200)
    }

    // Subsequent request must be rate limited (429)
    // ...and the very next one is rejected with 429 Too Many Requests.
    const blocked = await artistGet({} as Request, { params: { id: '42' } })
    expect(blocked.status).toBe(429)
    const data = await blocked.json()
    expect(data.error).toBe('Too Many Requests')
  })

  it('supports Pages Router / Express style handler interface', async () => {
    // Captured by the fake response below so the test can inspect what the
    // handler wrote.
    let statusCode = 0
    let jsonBody: unknown = null

    // Minimal stand-in for an Express/Next.js `res`. `status()` returns
    // `this` so calls can be chained, like `res.status(400).json(...)`.
    const mockRes = {
      status(code: number) {
        statusCode = code
        return this
      },
      json(body: unknown) {
        jsonBody = body
      },
    }

    // Valid ID: the handler reads the ID from `req.query` in this interface.
    await artistHandler({ query: { id: '42' } }, mockRes)
    expect(statusCode).toBe(200)
    expect(jsonBody).toMatchObject({ id: '42' })

    // Reusing the same mock: invalid input overwrites the captured values.
    await artistHandler({ query: { id: "1' OR '1'='1" } }, mockRes)
    expect(statusCode).toBe(400)
    expect(jsonBody).toMatchObject({ error: 'Bad Request' })
  })
})

describe('api/marketplace/[id].tsx and api/portfolio/[id].tsx route handlers (#940)', () => {
  // Note: unlike the artist route, these two have no rate-limit reset in a
  // `beforeEach`, and these tests make only a few requests each.

  it('marketplace route validates valid ID and blocks injections', async () => {
    // Slug-style IDs are valid for marketplace listings.
    const validRes = await marketplaceGet({} as Request, { params: { id: 'listing-42' } })
    expect(validRes.status).toBe(200)

    // SQL injection is rejected with a message naming the cause.
    const sqlRes = await marketplaceGet({} as Request, {
      params: { id: '1; DROP TABLE listings' },
    })
    expect(sqlRes.status).toBe(400)
    const sqlData = await sqlRes.json()
    expect(sqlData.message).toMatch(/sql injection/i)

    // So is path traversal (status only is checked here).
    const traversalRes = await marketplaceGet({} as Request, {
      params: { id: '../../passwd' },
    })
    expect(traversalRes.status).toBe(400)
  })

  it('portfolio route validates valid ID and blocks injections', async () => {
    const validRes = await portfolioGet({} as Request, { params: { id: 'artwork-10' } })
    expect(validRes.status).toBe(200)

    const sqlRes = await portfolioGet({} as Request, {
      params: { id: "10' OR '1'='1" },
    })
    expect(sqlRes.status).toBe(400)

    // Backslash-style traversal, as used on Windows paths.
    const traversalRes = await portfolioGet({} as Request, {
      params: { id: '..\\..\\windows' },
    })
    expect(traversalRes.status).toBe(400)
  })

  it('supports Pages Router / Express style handlers for marketplace and portfolio', async () => {
    // Same capture pattern as in the artist handler test above.
    let statusCode = 0
    let jsonBody: unknown = null

    const mockRes = {
      status(code: number) {
        statusCode = code
        return this
      },
      json(body: unknown) {
        jsonBody = body
      },
    }

    // Marketplace: one valid and one injected ID.
    await marketplaceHandler({ query: { id: 'listing-100' } }, mockRes)
    expect(statusCode).toBe(200)
    expect(jsonBody).toMatchObject({ id: 'listing-100' })

    await marketplaceHandler({ query: { id: "1' OR '1'='1" } }, mockRes)
    expect(statusCode).toBe(400)
    expect(jsonBody).toMatchObject({ error: 'Bad Request' })

    // Portfolio: one valid and one traversal attempt.
    await portfolioHandler({ query: { id: 'artwork-500' } }, mockRes)
    expect(statusCode).toBe(200)
    expect(jsonBody).toMatchObject({ id: 'artwork-500' })

    await portfolioHandler({ query: { id: '../secret' } }, mockRes)
    expect(statusCode).toBe(400)
    expect(jsonBody).toMatchObject({ error: 'Bad Request' })
  })
})
