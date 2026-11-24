import type { Review } from '@/types'

export const REVIEW_SORT_OPTIONS = [
  { value: 'recent', label: 'Most recent' },
  { value: 'highest', label: 'Highest rated' },
  { value: 'lowest', label: 'Lowest rated' },
] as const
export type ReviewSort = (typeof REVIEW_SORT_OPTIONS)[number]['value']

export function sortReviews(reviews: Review[], sort: ReviewSort): Review[] {
  const copy = [...reviews]
  const byId = (a: Review, b: Review) => a.id.localeCompare(b.id)

  if (sort === 'highest') return copy.sort((a, b) => b.rating - a.rating || byId(a, b))
  if (sort === 'lowest') return copy.sort((a, b) => a.rating - b.rating || byId(a, b))
  return copy.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt) || byId(a, b))
}
