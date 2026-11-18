import { describe, expect, it } from 'vitest'
import { clampIndex, getAdjacentIndices, normalizeImageList } from './mediaLightbox'

describe('media lightbox helpers', () => {
  it('normalizes empty and whitespace image lists', () => {
    expect(normalizeImageList([])).toEqual([])
    expect(normalizeImageList(['', '   ', 'https://example.com/one.png'])).toEqual(['https://example.com/one.png'])
  })

  it('handles null/undefined inputs gracefully', () => {
    expect(normalizeImageList(null)).toEqual([])
    expect(normalizeImageList(undefined)).toEqual([])
    expect(normalizeImageList([null, undefined, 'https://example.com/img.png'])).toEqual([
      'https://example.com/img.png',
    ])
  })

  it('keeps indexes within range for navigation', () => {
    expect(clampIndex(0, 3)).toBe(0)
    expect(clampIndex(10, 3)).toBe(2)
    expect(clampIndex(-4, 3)).toBe(0)
  })

  it('clampIndex returns 0 for an empty collection', () => {
    expect(clampIndex(0, 0)).toBe(0)
    expect(clampIndex(5, 0)).toBe(0)
    expect(clampIndex(-1, 0)).toBe(0)
  })

  it('returns adjacent indexes for the current image', () => {
    expect(getAdjacentIndices(1, 4)).toEqual({ previous: 0, next: 2 })
    expect(getAdjacentIndices(0, 4)).toEqual({ previous: 3, next: 1 })
  })

  it('getAdjacentIndices does not produce invalid indexes for an empty collection', () => {
    const result = getAdjacentIndices(0, 0)
    expect(result.previous).toBeGreaterThanOrEqual(0)
    expect(result.next).toBeGreaterThanOrEqual(0)
  })
})
