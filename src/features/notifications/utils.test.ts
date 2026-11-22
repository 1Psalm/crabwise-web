import { describe, expect, it } from 'vitest'
import { notificationStatusMeta } from '@/lib/status'
import { formatShortDate } from '@/lib'
import type { Notification, NotificationType, Paginated } from '@/types'
import {
  DEFAULT_PAGE_SIZE,
  FALLBACK_NOTIFICATION_KIND,
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_LABELS,
  UNREAD_POLL_INTERVAL_MS,
  adjustUnreadCount,
  applyReadState,
  applyReadToPages,
  countUnread,
  dedupeById,
  emptyPage,
  filterNotifications,
  isNotificationKind,
  formatNotificationTime,
  matchesFilters,
  mergePage,
  notificationKind,
  notificationKindMeta,
  notificationTarget,
  normalizeUnreadCount,
  unreadBadgeLabel,
  unreadIds,
} from './utils'

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    type: 'order',
    title: 'Order shipped',
    body: 'Your order is on its way',
    read: false,
    link: null,
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
    ...overrides,
  }
}

function page(
  items: Notification[],
  overrides: Partial<Paginated<Notification>> = {},
): Paginated<Notification> {
  return {
    items,
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    total: items.length,
    hasNextPage: false,
    ...overrides,
  }
}

describe('notification kind metadata', () => {
  it('covers every kind the mapper can produce', () => {
    // `mapNotification` narrows an unknown wire type to 'system', so the
    // feature must have metadata for all six possible outcomes.
    expect([...NOTIFICATION_KINDS].sort()).toEqual(
      ['commission', 'message', 'order', 'payment', 'review', 'system'].sort(),
    )
  })

  it('has a label for every kind', () => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(NOTIFICATION_KIND_LABELS[kind]).toBeTruthy()
    }
  })

  it('takes its labels from the shared status metadata', () => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(NOTIFICATION_KIND_LABELS[kind]).toBe(notificationStatusMeta(kind).label)
      expect(notificationStatusMeta(kind).className).not.toBe('')
    }
  })
})

describe('notification kind fallbacks', () => {
  it('recognises every supported kind', () => {
    for (const kind of NOTIFICATION_KINDS) expect(isNotificationKind(kind)).toBe(true)
  })

  it('rejects values the API could add before the client supports them', () => {
    for (const value of ['badge', 'ORDER', '', null, undefined, 42, ['order'], { type: 'order' }]) {
      expect(isNotificationKind(value)).toBe(false)
    }
  })

  it('narrows an unknown kind to the fallback instead of leaking it through', () => {
    expect(notificationKind('badge')).toBe(FALLBACK_NOTIFICATION_KIND)
    expect(notificationKind(undefined)).toBe(FALLBACK_NOTIFICATION_KIND)
    expect(notificationKind('review')).toBe('review')
  })

  it('gives an unknown kind readable metadata rather than undefined', () => {
    const meta = notificationKindMeta('badge')
    expect(meta).toEqual(notificationStatusMeta(FALLBACK_NOTIFICATION_KIND))
    expect(meta.label).toBeTruthy()
    expect(meta.className).not.toBe('')
  })
})

describe('notificationTarget', () => {
  it('follows an in-app path', () => {
    expect(notificationTarget({ type: 'order', link: '/orders/42' })).toBe('/orders/42')
  })

  it('has no target when the notification has no link', () => {
    expect(notificationTarget({ type: 'system', link: null })).toBeNull()
    expect(notificationTarget({ type: 'system', link: '   ' })).toBeNull()
  })

  it('refuses external and protocol-relative destinations', () => {
    for (const link of [
      'https://evil.example/path',
      '//evil.example/path',
      'javascript:alert(1)',
      'orders/42',
    ]) {
      expect(notificationTarget({ type: 'order', link })).toBeNull()
    }
  })

  it('has no target for an unknown kind even when a link is present', () => {
    expect(notificationTarget({ type: 'badge' as NotificationType, link: '/orders/42' })).toBeNull()
  })
})

describe('countUnread', () => {
  it('counts only unread notifications', () => {
    expect(
      countUnread([
        makeNotification({ id: 'a' }),
        makeNotification({ id: 'b', read: true }),
        makeNotification({ id: 'c' }),
      ]),
    ).toBe(2)
  })

  it('is zero for an empty list', () => {
    expect(countUnread([])).toBe(0)
  })
})

describe('unread badge counts', () => {
  it('normalizes raw totals to non-negative integers', () => {
    expect(normalizeUnreadCount(-3)).toBe(0)
    expect(normalizeUnreadCount(2.9)).toBe(2)
    expect(normalizeUnreadCount('4')).toBe(4)
    expect(normalizeUnreadCount(Number.NaN)).toBe(0)
    expect(normalizeUnreadCount(undefined)).toBe(0)
  })

  it('never renders a badge for zero', () => {
    expect(unreadBadgeLabel(0)).toBeNull()
    expect(unreadBadgeLabel(-1)).toBeNull()
    expect(unreadBadgeLabel(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('renders the normalized integer for a real count', () => {
    expect(unreadBadgeLabel(7)).toBe('7')
    expect(unreadBadgeLabel(7.8)).toBe('7')
  })

  it('counts unread notifications as a non-negative integer', () => {
    const count = countUnread([makeNotification({ id: 'a' }), makeNotification({ id: 'b' })])
    expect(Number.isInteger(count)).toBe(true)
    expect(count).toBeGreaterThanOrEqual(0)
  })
})

describe('unreadIds', () => {
  it('returns only the unread ids, in order', () => {
    expect(
      unreadIds([
        makeNotification({ id: 'a' }),
        makeNotification({ id: 'b', read: true }),
        makeNotification({ id: 'c' }),
      ]),
    ).toEqual(['a', 'c'])
  })
})

describe('dedupeById', () => {
  it('keeps the first occurrence of a repeated id', () => {
    const first = makeNotification({ id: 'a', title: 'first' })
    const second = makeNotification({ id: 'a', title: 'second' })
    const result = dedupeById([first, makeNotification({ id: 'b' }), second])

    expect(result).toHaveLength(2)
    expect(result[0]?.title).toBe('first')
  })

  it('leaves a unique list untouched', () => {
    const list = [makeNotification({ id: 'a' }), makeNotification({ id: 'b' })]
    expect(dedupeById(list)).toEqual(list)
  })
})

describe('mergePage', () => {
  it('never produces a duplicate after a refetch', () => {
    const cached = [makeNotification({ id: 'a' }), makeNotification({ id: 'b' })]
    const refetched = [
      makeNotification({ id: 'a' }),
      makeNotification({ id: 'b' }),
      makeNotification({ id: 'c' }),
    ]

    const result = mergePage(cached, refetched)
    expect(result).toHaveLength(3)
    expect(new Set(result.map((n) => n.id)).size).toBe(3)
  })

  it('orders newest first', () => {
    const older = makeNotification({ id: 'old', createdAt: new Date('2026-01-01T09:00:00.000Z') })
    const newer = makeNotification({ id: 'new', createdAt: new Date('2026-01-01T11:00:00.000Z') })
    expect(mergePage([older], [newer]).map((n) => n.id)).toEqual(['new', 'old'])
  })

  it('does not mutate its inputs', () => {
    const cached = [makeNotification({ id: 'a' })]
    mergePage(cached, [makeNotification({ id: 'b' })])
    expect(cached).toHaveLength(1)
  })
})

describe('applyReadState', () => {
  it('marks the listed ids and leaves the rest untouched', () => {
    const list = [
      makeNotification({ id: 'a' }),
      makeNotification({ id: 'b' }),
      makeNotification({ id: 'c', read: true }),
    ]
    const result = applyReadState(list, ['a', 'c'], true)

    expect(result.map((n) => n.read)).toEqual([true, false, true])
  })

  it('supports marking unread again', () => {
    const list = [makeNotification({ id: 'a', read: true })]
    expect(applyReadState(list, ['a'], false)[0]?.read).toBe(false)
  })

  it('ignores unknown ids', () => {
    const list = [makeNotification({ id: 'a' })]
    expect(applyReadState(list, ['missing'], true)).toEqual(list)
  })

  it('does not mutate the input list', () => {
    const list = [makeNotification({ id: 'a' })]
    applyReadState(list, ['a'], true)
    expect(list[0]?.read).toBe(false)
  })
})

describe('applyReadToPages', () => {
  it('updates every page that contains a listed id', () => {
    const pages = [
      page([makeNotification({ id: 'a' }), makeNotification({ id: 'b' })]),
      page([makeNotification({ id: 'c' })], { page: 2 }),
    ]
    const result = applyReadToPages(pages, ['a', 'c'], true)

    expect(result[0]?.items.map((n) => n.read)).toEqual([true, false])
    expect(result[1]?.items.map((n) => n.read)).toEqual([true])
  })

  it('returns an unchanged page by reference so React Query can skip the re-render', () => {
    const pages = [page([makeNotification({ id: 'a' })])]
    expect(applyReadToPages(pages, ['missing'], true)[0]).toBe(pages[0])
  })

  it('keeps each page identity for a matching id and preserves pagination fields', () => {
    const pages = [page([makeNotification({ id: 'a' })], { page: 3, total: 42, hasNextPage: true })]
    const [updated] = applyReadToPages(pages, ['a'], true)

    expect(updated).not.toBe(pages[0])
    expect(updated?.page).toBe(3)
    expect(updated?.total).toBe(42)
    expect(updated?.hasNextPage).toBe(true)
  })
})

describe('adjustUnreadCount', () => {
  it('decrements by the number that were actually unread', () => {
    const pages = [page([makeNotification({ id: 'a' }), makeNotification({ id: 'b', read: true })])]
    expect(adjustUnreadCount(7, pages, ['a', 'b'], true)).toBe(6)
  })

  it('never goes negative when the cache is behind the server', () => {
    const pages = [page([makeNotification({ id: 'a' })])]
    expect(adjustUnreadCount(0, pages, ['a'], true)).toBe(0)
  })

  it('is a no-op for ids that were not cached', () => {
    const pages = [page([makeNotification({ id: 'a' })])]
    expect(adjustUnreadCount(5, pages, ['missing'], true)).toBe(5)
  })

  it('increments when marking unread', () => {
    const pages = [page([makeNotification({ id: 'a', read: true })])]
    expect(adjustUnreadCount(5, pages, ['a'], false)).toBe(6)
  })
})

describe('filtering', () => {
  const list = [
    makeNotification({ id: 'a', type: 'order' as NotificationType }),
    makeNotification({ id: 'b', type: 'message' as NotificationType, read: true }),
    makeNotification({ id: 'c', type: 'system' as NotificationType }),
  ]

  it('matches every notification when no filter is given', () => {
    expect(matchesFilters(list[0]!, {})).toBe(true)
  })

  it('narrows by kind', () => {
    expect(filterNotifications(list, { types: ['order', 'system'] }).map((n) => n.id)).toEqual([
      'a',
      'c',
    ])
  })

  it('narrows by read state', () => {
    expect(filterNotifications(list, { read: false }).map((n) => n.id)).toEqual(['a', 'c'])
    expect(filterNotifications(list, { read: true }).map((n) => n.id)).toEqual(['b'])
  })

  it('combines kind and read state', () => {
    expect(filterNotifications(list, { types: ['message'], read: true }).map((n) => n.id)).toEqual([
      'b',
    ])
  })

  it('treats an empty type list as "every kind"', () => {
    expect(filterNotifications(list, { types: [] })).toHaveLength(3)
  })
})

describe('freshness budget', () => {
  it('polls inside the 30s acceptance budget', () => {
    expect(UNREAD_POLL_INTERVAL_MS).toBeLessThanOrEqual(30_000)
    expect(UNREAD_POLL_INTERVAL_MS).toBeGreaterThan(0)
  })
})

describe('emptyPage', () => {
  it('uses the supplied pagination and reports no next page', () => {
    expect(emptyPage({ page: 4, pageSize: 5 })).toEqual({
      items: [],
      page: 4,
      pageSize: 5,
      total: 0,
      hasNextPage: false,
    })
  })

  it('falls back to the default page size', () => {
    expect(emptyPage().pageSize).toBe(DEFAULT_PAGE_SIZE)
    expect(emptyPage().page).toBe(1)
  })
})

describe('formatNotificationTime', () => {
  const now = new Date('2026-11-22T12:00:00.000Z')
  const before = (milliseconds: number): Date => new Date(now.getTime() - milliseconds)

  const MINUTE = 60_000
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR

  it('labels anything under a minute old, and clock skew, as just now', () => {
    expect(formatNotificationTime(before(0), now)).toBe('Just now')
    expect(formatNotificationTime(before(MINUTE - 1), now)).toBe('Just now')
    expect(formatNotificationTime(before(-5 * MINUTE), now)).toBe('Just now')
  })

  it('renders whole minutes under an hour', () => {
    expect(formatNotificationTime(before(MINUTE), now)).toBe('1m ago')
    expect(formatNotificationTime(before(HOUR - 1), now)).toBe('59m ago')
  })

  it('renders whole hours under a day', () => {
    expect(formatNotificationTime(before(HOUR), now)).toBe('1h ago')
    expect(formatNotificationTime(before(DAY - MINUTE), now)).toBe('23h ago')
  })

  it('renders whole days under a week', () => {
    expect(formatNotificationTime(before(DAY), now)).toBe('1d ago')
    expect(formatNotificationTime(before(7 * DAY - 1), now)).toBe('6d ago')
  })

  it('falls back to the shared short date at a week and beyond', () => {
    expect(formatNotificationTime(before(7 * DAY), now)).toBe(
      formatShortDate(before(7 * DAY).toISOString()),
    )
    expect(formatNotificationTime(before(400 * DAY), now)).toBe(
      formatShortDate(before(400 * DAY).toISOString()),
    )
  })

  it('never renders Invalid Date for a timestamp it cannot parse', () => {
    const result = formatNotificationTime(new Date('not-a-date'), now)

    expect(result).toBe('')
    expect(result).not.toMatch(/invalid/i)
  })

  it('treats a non-Date value from a persisted cache as unparseable', () => {
    expect(formatNotificationTime('2026-11-22T12:00:00.000Z' as unknown as Date, now)).toBe('')
  })

  it('is stable for the same timestamp and reference time', () => {
    const createdAt = before(3 * HOUR)
    expect(formatNotificationTime(createdAt, now)).toBe(formatNotificationTime(createdAt, now))
  })
})
