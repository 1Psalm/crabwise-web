import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_AUTHENTICATED_PATH,
  redactUrl,
  resolvePostLoginRedirect,
  safeExternalUrl,
  safeRedirect,
} from './url'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('safeRedirect (#862)', () => {
  it('keeps a normal app-relative path', () => {
    expect(safeRedirect('/dashboard')).toBe('/dashboard')
    expect(safeRedirect('/artist/listings?status=draft')).toBe('/artist/listings?status=draft')
  })

  it('falls back when there is nothing usable to redirect to', () => {
    expect(safeRedirect(null)).toBe(DEFAULT_AUTHENTICATED_PATH)
    expect(safeRedirect(undefined)).toBe(DEFAULT_AUTHENTICATED_PATH)
    expect(safeRedirect('')).toBe(DEFAULT_AUTHENTICATED_PATH)
    expect(safeRedirect(42)).toBe(DEFAULT_AUTHENTICATED_PATH)
  })

  it('rejects absolute, scheme-based and protocol-relative destinations', () => {
    expect(safeRedirect('https://evil.com')).toBe(DEFAULT_AUTHENTICATED_PATH)
    expect(safeRedirect('javascript:alert(1)')).toBe(DEFAULT_AUTHENTICATED_PATH)
    expect(safeRedirect('//evil.com')).toBe(DEFAULT_AUTHENTICATED_PATH)
    expect(safeRedirect('/\\evil.com')).toBe(DEFAULT_AUTHENTICATED_PATH)
  })

  it('rejects encoded whitespace and slash variants of a protocol-relative URL', () => {
    expect(safeRedirect('/%09/evil.com')).toBe(DEFAULT_AUTHENTICATED_PATH)
    expect(safeRedirect('/%0a/evil.com')).toBe(DEFAULT_AUTHENTICATED_PATH)
    expect(safeRedirect('/%2F%2Fevil.com')).toBe(DEFAULT_AUTHENTICATED_PATH)
  })

  it('falls back on a malformed escape sequence', () => {
    expect(safeRedirect('/%')).toBe(DEFAULT_AUTHENTICATED_PATH)
  })
})

describe('resolvePostLoginRedirect (#862)', () => {
  it('prefers a validated state.from over the query string', () => {
    expect(resolvePostLoginRedirect({ from: '/orders/7' }, '/fallback')).toBe('/orders/7')
  })

  it('ignores an unsafe state.from and falls back to the query string', () => {
    expect(resolvePostLoginRedirect({ from: '//evil.com' }, '/orders/7')).toBe('/orders/7')
    expect(resolvePostLoginRedirect({ from: 'javascript:alert(1)' }, null)).toBe(
      DEFAULT_AUTHENTICATED_PATH,
    )
  })

  it('narrows non-string router state instead of trusting it', () => {
    expect(resolvePostLoginRedirect({ from: { toString: () => '/evil' } }, '/orders')).toBe(
      '/orders',
    )
    expect(resolvePostLoginRedirect('not-an-object', '/orders')).toBe('/orders')
  })
})

describe('safeExternalUrl (#863)', () => {
  it('accepts an https URL', () => {
    expect(safeExternalUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
  })

  it('accepts a URL with a path, query, port and fragment', () => {
    expect(safeExternalUrl('https://cdn.example.com:8443/a.png?v=2#top')).toBe(
      'https://cdn.example.com:8443/a.png?v=2#top',
    )
  })

  it('normalises scheme and host casing', () => {
    expect(safeExternalUrl('HTTPS://CDN.Example.COM/a.png')).toBe('https://cdn.example.com/a.png')
  })

  it('rejects a javascript:, data:, vbscript:, file: or blob: URL', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalUrl('JaVaScRiPt:alert(1)')).toBeNull()
    expect(safeExternalUrl('data:text/html;base64,PHNjcmlwdD4=')).toBeNull()
    expect(safeExternalUrl('vbscript:msgbox(1)')).toBeNull()
    expect(safeExternalUrl('file:///etc/passwd')).toBeNull()
    expect(safeExternalUrl('blob:https://cdn.example.com/uuid')).toBeNull()
  })

  it('rejects a protocol-relative or relative URL', () => {
    expect(safeExternalUrl('//evil.com/x')).toBeNull()
    expect(safeExternalUrl('/account/GABC')).toBeNull()
    expect(safeExternalUrl('cdn.example.com/a.png')).toBeNull()
  })

  it('rejects a non-string or empty value', () => {
    expect(safeExternalUrl(null)).toBeNull()
    expect(safeExternalUrl(undefined)).toBeNull()
    expect(safeExternalUrl('')).toBeNull()
    expect(safeExternalUrl('   ')).toBeNull()
    expect(safeExternalUrl(42)).toBeNull()
    expect(safeExternalUrl({ toString: () => 'https://evil.com' })).toBeNull()
  })

  it('rejects malformed and hostless URLs without throwing', () => {
    expect(safeExternalUrl('https://')).toBeNull()
    expect(safeExternalUrl('https:///path')).toBeNull()
    expect(safeExternalUrl('https://?q=1')).toBeNull()
    expect(safeExternalUrl('not a url')).toBeNull()
    expect(safeExternalUrl('https//evil.com')).toBeNull()
    expect(safeExternalUrl('https://[::1')).toBeNull()
  })

  it('rejects surrounding and embedded whitespace', () => {
    expect(safeExternalUrl(' https://cdn.example.com/a.png')).toBeNull()
    expect(safeExternalUrl('https://cdn.example.com/a.png ')).toBeNull()
    expect(safeExternalUrl('https://cdn.example.com/a b.png')).toBeNull()
    expect(safeExternalUrl('https://cdn.exa\tmple.com/a.png')).toBeNull()
    expect(safeExternalUrl('https://cdn.exa\nmple.com/a.png')).toBeNull()
  })

  it('rejects URLs containing control characters', () => {
    expect(safeExternalUrl('https://cdn.example.com/\u0000')).toBeNull()
    expect(safeExternalUrl('https://cdn.example.com/\u001f')).toBeNull()
    expect(safeExternalUrl('https://cdn.example.com/\u007f')).toBeNull()
  })

  it('rejects backslashes that browsers treat as path separators', () => {
    expect(safeExternalUrl('https:\\\\evil.com/a.png')).toBeNull()
    expect(safeExternalUrl('https://cdn.example.com\\@evil.com')).toBeNull()
    expect(safeExternalUrl('https://cdn.example.com\\a.png')).toBeNull()
  })

  it('rejects embedded credentials and the host-spoofing form', () => {
    expect(safeExternalUrl('https://user:pass@cdn.example.com/a.png')).toBeNull()
    expect(safeExternalUrl('https://user@cdn.example.com/a.png')).toBeNull()
    expect(safeExternalUrl('https://cdn.example.com@evil.com/a.png')).toBeNull()
  })

  it('restricts hosts when an allow-list is supplied', () => {
    expect(safeExternalUrl('https://cdn.example.com/a.png', ['cdn.example.com'])).toBe(
      'https://cdn.example.com/a.png',
    )
    expect(safeExternalUrl('https://evil.com/a.png', ['cdn.example.com'])).toBeNull()
  })

  it('matches the allow-list case-insensitively and ignores a trailing root dot', () => {
    expect(safeExternalUrl('https://CDN.example.com/a.png', ['cdn.example.com'])).toBe(
      'https://cdn.example.com/a.png',
    )
    expect(safeExternalUrl('https://cdn.example.com./a.png', ['cdn.example.com'])).toBe(
      'https://cdn.example.com./a.png',
    )
    expect(safeExternalUrl('https://cdn.example.com/a.png', ['CDN.EXAMPLE.COM.'])).toBe(
      'https://cdn.example.com/a.png',
    )
  })

  it('does not treat a lookalike host as an allow-list match', () => {
    expect(
      safeExternalUrl('https://cdn.example.com.evil.com/a.png', ['cdn.example.com']),
    ).toBeNull()
    expect(
      safeExternalUrl('https://cdn.example.com.evil.com/a.png', ['cdn.example.com.evil.com']),
    ).toBe('https://cdn.example.com.evil.com/a.png')
  })

  it('treats an empty allow-list as no restriction', () => {
    expect(safeExternalUrl('https://evil.com/a.png', [])).toBe('https://evil.com/a.png')
  })

  it('preserves the development/production protocol policy', () => {
    vi.stubEnv('PROD', '')
    expect(safeExternalUrl('http://cdn.example.com/a.png')).toBe('http://cdn.example.com/a.png')

    vi.stubEnv('PROD', 'true')
    expect(safeExternalUrl('http://cdn.example.com/a.png')).toBeNull()
    expect(safeExternalUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
  })
})

describe('redactUrl (#865)', () => {
  it('redacts a long token-shaped path segment', () => {
    const token = 'a'.repeat(48)
    expect(redactUrl(`/auth/reset-password/${token}`)).toBe('/auth/reset-password/[redacted]')
  })

  it('leaves short, ordinary paths untouched', () => {
    expect(redactUrl('/orders/42')).toBe('/orders/42')
    expect(redactUrl(undefined)).toBeUndefined()
  })
})
