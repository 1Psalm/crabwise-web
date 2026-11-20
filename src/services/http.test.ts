import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AxiosError, AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getApiErrorMessage,
  getErrorMessage,
  http,
  isApiError,
  retryDelayMs,
  setAuthTokenProvider,
  setTokenRefresher,
  setUnauthorizedHandler,
} from './http'
import { normalizeApiUrl } from '@/config/env'

/**
 * Tests for the shared HTTP client (`./http`).
 *
 * Covered here:
 *  - API base URL normalization
 *  - Token refresh on 401, including concurrent requests
 *  - Protection against refresh loops / request storms
 *  - Centralized, user-safe error mapping
 *  - Retry delay calculation (Retry-After handling)
 *
 * None of these tests touch the network. Each request is given a fake axios
 * `adapter` that decides the response, so the interceptors in `http` run for
 * real while the "server" is entirely controlled by the test.
 */

// The access token the fake auth provider currently returns. Tests mutate it
// to simulate an expired token being replaced by a refreshed one.
let token: string | null

describe('API URL configuration', () => {
  it('removes trailing slashes while preserving the URL origin', () => {
    // Trailing slashes would produce double slashes when paths are appended
    // (e.g. "https://api.example.com//me"), so they are stripped.
    expect(normalizeApiUrl('https://api.example.com/')).toBe('https://api.example.com')
    expect(normalizeApiUrl('https://api.example.com///')).toBe('https://api.example.com')
    // Already-clean URLs are left untouched.
    expect(normalizeApiUrl('https://api.example.com')).toBe('https://api.example.com')
  })

  it('does not turn a root URL into an empty base', () => {
    // Edge case: stripping slashes from a bare scheme must not eat the scheme's
    // own "//" and leave an invalid or empty base URL.
    expect(normalizeApiUrl('https://')).toBe('https://')
  })
})

/**
 * Fake server: accepts only `Bearer new`, answers 401 otherwise.
 *
 * Behaves like a real backend that rejects the old ("expired") token and
 * accepts the refreshed one. Axios adapters resolve for success and throw an
 * AxiosError for failures, which is what the real transport does for non-2xx
 * statuses, so the 401 handling in the response interceptor is exercised.
 */
const adapter: AxiosAdapter = async (config) => {
  const headers = AxiosHeaders.from(config.headers)
  const response = { data: 'ok', status: 200, statusText: 'OK', headers: {}, config }
  // Only the refreshed token is valid.
  if (headers.get('Authorization') === 'Bearer new') return response
  // Anything else (expired token, no token) is rejected as unauthorized.
  const unauthorized = { ...response, data: {}, status: 401, statusText: 'Unauthorized' }
  throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, null, unauthorized)
}

afterEach(() => {
  // Module-level HTTP state must not leak between tests (#794), otherwise
  // test order can mask the concurrency bugs this file exists to cover.
  // Reset every injected dependency to a harmless no-op.
  setAuthTokenProvider(() => null)
  setTokenRefresher(async () => null)
  setUnauthorizedHandler(() => {})
})

describe('http token refresh', () => {
  beforeEach(() => {
    // Every test starts with an expired token, so the first request to the
    // fake server is guaranteed to receive a 401.
    token = 'expired'
    setAuthTokenProvider(() => token)
  })

  it('refreshes once for concurrent 401s and retries every original request', async () => {
    const refresher = vi.fn(async () => {
      // A short delay keeps the refresh "in flight" long enough for all three
      // requests below to hit their 401 while it is still pending. That is
      // what proves they share one refresh instead of each starting their own.
      // (Note: `resolve` here is the Promise callback and shadows the
      // `resolve` imported from node:path; it is unrelated to path handling.)
      await new Promise((resolve) => setTimeout(resolve, 10))
      token = 'new'
      return token
    })
    const onUnauthorized = vi.fn()
    setTokenRefresher(refresher)
    setUnauthorizedHandler(onUnauthorized)

    // Fire three requests at once, all carrying the expired token.
    const results = await Promise.all([1, 2, 3].map(() => http.get<string>('/me', { adapter })))

    // Every original request was retried with the new token and succeeded...
    expect(results).toEqual(['ok', 'ok', 'ok'])
    // ...after exactly one refresh, not one per failed request...
    expect(refresher).toHaveBeenCalledTimes(1)
    // ...and the user was never signed out, because the refresh worked.
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('clears the session when the refresh fails', async () => {
    const onUnauthorized = vi.fn()
    // Simulate the refresh token being rejected (expired, revoked, etc.).
    setTokenRefresher(async () => {
      throw new Error('refresh rejected')
    })
    setUnauthorizedHandler(onUnauthorized)

    // The caller still sees a 401 (not the refresher's raw error)...
    await expect(http.get('/me', { adapter })).rejects.toMatchObject({ status: 401 })
    // ...and the unauthorized handler fires exactly once so the app can clear
    // the session and send the user to sign in.
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })
})

describe('centralized API errors', () => {
  it('maps catalog codes without exposing backend messages', () => {
    // Known error codes resolve to fixed, user-friendly copy from the catalog.
    expect(getApiErrorMessage('AUTH_INVALID_CREDENTIALS', 401)).toBe(
      'The email or password is incorrect.',
    )
    // Unknown/unexpected errors fall back to a generic message so internal
    // details (like a database connection string) never reach the UI.
    expect(getErrorMessage(new Error('database connection string'))).toBe(
      'An unexpected error occurred.',
    )
  })

  it('normalizes validation fields and preserves request context', async () => {
    // A server response with a validation failure, including a per-field error
    // list, a request id for support/debugging, and a raw backend message that
    // must NOT be shown to the user.
    const validationAdapter: AxiosAdapter = async (config) => {
      throw new AxiosError('technical backend detail', 'ERR_BAD_REQUEST', config, null, {
        data: {
          code: 'VALIDATION_FAILED',
          message: 'raw backend detail',
          requestId: 'req-123',
          errors: [{ path: ['email'], message: 'Enter a valid email.' }],
        },
        status: 422,
        statusText: 'Unprocessable Entity',
        headers: {},
        config,
      })
    }

    try {
      await http.post('/register', {}, { adapter: validationAdapter })
      // Guard: if the request unexpectedly succeeds, fail loudly instead of
      // letting the test pass without running the assertions below.
      expect.fail('request should reject')
    } catch (error) {
      // The rejection is a normalized ApiError, not a raw AxiosError.
      expect(isApiError(error)).toBe(true)
      expect(error).toMatchObject({
        status: 422,
        code: 'VALIDATION_FAILED',
        // Field errors are flattened to { fieldName: message } for forms.
        fieldErrors: { email: 'Enter a valid email.' },
        // The request id is preserved so users/support can reference it.
        requestId: 'req-123',
        // The message comes from the catalog, not from the backend's
        // `message` or the AxiosError message.
        message: 'Check the highlighted fields and try again.',
      })
    }
  })
})

describe('401 on the refresh endpoint', () => {
  it('does not re-enter the refresh branch (no request storm)', async () => {
    token = 'expired'
    setAuthTokenProvider(() => token)

    // Counts how many times the refresh endpoint is actually hit.
    const refreshCalls = vi.fn()
    // Local adapter (shadows the module-level one): every request, including
    // the refresh call itself, is rejected with 401. This is the worst case,
    // where a naive client would try to refresh in response to the failed
    // refresh, looping forever.
    const adapter: AxiosAdapter = async (config) => {
      if (config.url === '/auth/refresh') refreshCalls()
      throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, null, {
        data: {},
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        config,
      })
    }

    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    const refresher = vi.fn(async () => {
      try {
        // Mirrors authService.refresh / authApi.refresh: the refresh call
        // itself opts out of the 401 branch.
        // `skipAuthRefresh` stops the interceptor from refreshing on this
        // call's 401; `skipRetry` stops the generic retry logic from
        // re-sending it.
        await http.post('/auth/refresh', {}, { adapter, skipAuthRefresh: true, skipRetry: true })
      } catch {
        // A failed refresh yields "no token" rather than throwing.
        return null
      }
      return null
    })
    setTokenRefresher(refresher)

    await expect(http.get('/me', { adapter })).rejects.toMatchObject({ status: 401 })

    // One refresh attempt, one call to the refresh endpoint, one sign-out.
    // Anything higher would indicate a loop or duplicate handling.
    expect(refresher).toHaveBeenCalledTimes(1)
    expect(refreshCalls).toHaveBeenCalledTimes(1)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })
})

describe('authApi.refresh', () => {
  it('sets skipAuthRefresh so a rejected refresh never loops (source guard)', () => {
    // A "source guard" test: it reads the source text instead of running the
    // code. The real `authApi.refresh` needs a live server, so this cheaply
    // protects against someone removing the `skipAuthRefresh` flag that the
    // previous test depends on. If the file moves or the call is rewritten,
    // update the path/search string here.
    const source = readFileSync(resolve(__dirname, '../features/auth/services/authApi.ts'), 'utf8')
    const call = source.indexOf("'/auth/refresh'")
    // Make sure the endpoint string was found at all, so the check below is
    // not silently run against index -1.
    expect(call).toBeGreaterThan(-1)
    // The flag must appear in the options of that same call (within 240 chars).
    expect(source.slice(call, call + 240)).toContain('skipAuthRefresh: true')
  })
})

describe('retryDelayMs', () => {
  // Builds an AxiosError carrying a response with the given status and
  // headers, which is the only input `retryDelayMs` needs to decide a delay.
  function responseError(status: number, headers: Record<string, string>): AxiosError {
    const config = {
      method: 'get',
      url: '/resource',
      headers: {},
    } as unknown as InternalAxiosRequestConfig
    const response = { data: {}, status, statusText: '', headers, config }
    return new AxiosError('failed', 'ERR_BAD_REQUEST', config, null, response)
  }

  it('honours the Retry-After header on a 429 (seconds → ms)', () => {
    // The server says "wait 2 seconds", so the delay is 2000 ms.
    expect(retryDelayMs(responseError(429, { 'retry-after': '2' }), 1)).toBe(2000)
  })

  it('caps an absurd Retry-After value', () => {
    // 3600 s (1 hour) would stall the UI, so the delay is clamped to 30 s.
    expect(retryDelayMs(responseError(429, { 'retry-after': '3600' }), 1)).toBe(30_000)
  })

  it('falls back to the base delay when the header is missing or malformed', () => {
    // No header: base delay for attempt 1 is 500 ms.
    expect(retryDelayMs(responseError(429, {}), 1)).toBe(500)
    // Unparseable header ("soon"): ignored, and the fallback grows with the
    // attempt number (attempt 2 → 1000 ms, i.e. it doubles per attempt).
    expect(retryDelayMs(responseError(429, { 'retry-after': 'soon' }), 2)).toBe(1000)
  })
})
