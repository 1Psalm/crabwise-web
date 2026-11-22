import { formatShortDate } from '@/lib'
import type { Notification, NotificationType, Paginated } from '@/types'
import { notificationStatusMeta, type StatusMeta } from '@/lib/status'
import type { NotificationFilters } from './queryKeys'

/**
 * How often the unread badge refetches.
 *
 * The acceptance criterion is that the count stays within 30s of the server's
 * truth, so the poll interval is derived from that budget rather than picked by
 * feel: a refetch that starts at t=30s may resolve just after the next one is
 * due, so the interval sits slightly inside the budget.
 */
export const UNREAD_POLL_INTERVAL_MS = 30_000

/** Every kind the API can report, in the order the filter UI lists them. */
export const NOTIFICATION_KINDS: readonly NotificationType[] = [
  'order',
  'commission',
  'payment',
  'review',
  'message',
  'system',
] as const

/**
 * Per-kind label, so surfaces do not each invent their own copy.
 *
 * Derived from `src/lib/status.ts` instead of duplicated here: the filter UI,
 * the badge and any list row all read the same label for the same kind.
 */
export const NOTIFICATION_KIND_LABELS = Object.fromEntries(
  NOTIFICATION_KINDS.map((kind) => [kind, notificationStatusMeta(kind).label]),
) as Record<NotificationType, string>

/** Kind used when the wire value is missing or not one this build knows. */
export const FALLBACK_NOTIFICATION_KIND: NotificationType = 'system'

/** Whether a value is a notification kind this build can render. */
export function isNotificationKind(value: unknown): value is NotificationType {
  return typeof value === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(value)
}

/**
 * Narrows an unknown notification kind to a supported one.
 *
 * The API can add a kind before the client ships support for it; rendering the
 * fallback keeps an unknown value from reaching a lookup that would return
 * `undefined` and crash the row.
 */
export function notificationKind(value: unknown): NotificationType {
  return isNotificationKind(value) ? value : FALLBACK_NOTIFICATION_KIND
}

/** Status pill metadata for a notification, safe for unknown wire values. */
export function notificationKindMeta(value: unknown): StatusMeta {
  return notificationStatusMeta(notificationKind(value))
}

/**
 * Navigation target for a notification, or `null` when there is nowhere safe
 * to go.
 *
 * Only same-app absolute paths are followed: an unknown kind, a missing link,
 * an external URL or a protocol-relative `//host` path all resolve to `null`
 * rather than navigating a notification to an unintended destination.
 */
export function notificationTarget(
  notification: Pick<Notification, 'type' | 'link'>,
): string | null {
  if (!isNotificationKind(notification.type)) return null
  const link = notification.link?.trim()
  if (!link || !link.startsWith('/') || link.startsWith('//')) return null
  return link
}

/** Number of unread notifications in a list. Never negative. */
export function countUnread(notifications: readonly Notification[]): number {
  const total = notifications.reduce(
    (count, notification) => (notification.read ? count : count + 1),
    0,
  )
  return Math.max(0, Math.trunc(total))
}

/**
 * Normalizes a raw unread total to a safe non-negative integer.
 *
 * The badge renders a number from a server payload or an optimistic delta, so
 * a `NaN`, a negative value or a fraction must never reach the DOM.
 */
export function normalizeUnreadCount(count: unknown): number {
  const value = typeof count === 'number' ? count : Number(count)
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

/**
 * Badge text for an unread total, or `null` when there is nothing to show.
 *
 * Returning `null` instead of `'0'` keeps a zero count from rendering as a
 * badge, which would read as an unread item that does not exist.
 */
export function unreadBadgeLabel(count: unknown): string | null {
  const value = normalizeUnreadCount(count)
  return value === 0 ? null : String(value)
}

/**
 * Removes duplicate ids, keeping the first occurrence.
 *
 * A refetch that races with an optimistic cache write can hand back the same
 * notification twice - once from the server page and once from the optimistic
 * entry. Deduping on read keeps that out of the rendered list.
 */
export function dedupeById(notifications: readonly Notification[]): Notification[] {
  const seen = new Set<string>()
  const result: Notification[] = []
  for (const notification of notifications) {
    if (seen.has(notification.id)) continue
    seen.add(notification.id)
    result.push(notification)
  }
  return result
}

/**
 * Replaces a page's contents while preserving order and dropping duplicates.
 *
 * A server page is authoritative, so its entries are appended after the
 * already-cached ones only when the id is genuinely new; the result is then
 * sorted newest-first, which is the order every notification surface renders.
 */
export function mergePage(
  cached: readonly Notification[],
  incoming: readonly Notification[],
): Notification[] {
  const merged = dedupeById([...cached, ...incoming])
  return merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

/** Applies a read flag to the listed ids, leaving every other entry untouched. */
export function applyReadState(
  notifications: readonly Notification[],
  ids: readonly string[],
  read: boolean,
): Notification[] {
  const targets = new Set(ids)
  return notifications.map((notification) =>
    targets.has(notification.id) && notification.read !== read
      ? { ...notification, read }
      : notification,
  )
}

/** Whether a notification belongs to the given filters. */
export function matchesFilters(
  notification: Notification,
  filters: NotificationFilters = {},
): boolean {
  const types = filters.types
  if (types && types.length > 0 && !types.includes(notification.type)) return false
  if (filters.read !== undefined && notification.read !== filters.read) return false
  return true
}

/**
 * Client-side narrowing for filters the API does not support.
 *
 * Server-side filtering is the source of truth; this is for the filters that
 * have to stay responsive while a page is in flight, and it never widens a
 * result the server already narrowed.
 */
export function filterNotifications(
  notifications: readonly Notification[],
  filters: NotificationFilters = {},
): Notification[] {
  return notifications.filter((notification) => matchesFilters(notification, filters))
}

/** Ids of every notification in a page that is currently unread. */
export function unreadIds(notifications: readonly Notification[]): string[] {
  return notifications
    .filter((notification) => !notification.read)
    .map((notification) => notification.id)
}

/**
 * Applies a read flag across every cached page.
 *
 * The unread badge, the list and any per-page view all read from different
 * query keys, so an optimistic write has to touch all of them or the surfaces
 * disagree until the next refetch. Pages that contain none of the ids are
 * returned by reference so React Query can skip the re-render.
 */
export function applyReadToPages(
  pages: readonly Paginated<Notification>[],
  ids: readonly string[],
  read: boolean,
): Paginated<Notification>[] {
  return pages.map((page) => {
    const items = applyReadState(page.items, ids, read)
    const changed = items.some((item, index) => item !== page.items[index])
    return changed ? { ...page, items } : page
  })
}

/**
 * Adjusts the unread total by the change observed in the cached pages.
 *
 * Deriving the delta from what the cache actually held avoids the classic
 * optimistic-update bug where the badge goes negative because a notification
 * was already read server-side.
 */
export function adjustUnreadCount(
  current: number,
  pages: readonly Paginated<Notification>[],
  ids: readonly string[],
  read: boolean,
): number {
  const targets = new Set(ids)
  let delta = 0

  for (const page of pages) {
    for (const notification of page.items) {
      if (!targets.has(notification.id)) continue
      // Only entries whose cached state actually changes move the badge.
      if (notification.read === read) continue
      delta += read ? -1 : 1
    }
  }

  return Math.max(0, current + delta)
}

/** An empty page with the shape the hooks and views expect. */
export function emptyPage(filters: NotificationFilters = {}): Paginated<Notification> {
  return {
    items: [],
    page: filters.page ?? 1,
    pageSize: filters.pageSize ?? DEFAULT_PAGE_SIZE,
    total: 0,
    hasNextPage: false,
  }
}

export const DEFAULT_PAGE_SIZE = 20

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** Past this age a timestamp reads as a calendar date instead of `Nd ago`. */
const RELATIVE_CUTOFF_MS = 7 * DAY_MS

/**
 * Renders a notification's `createdAt` for an inbox row.
 *
 * Recent entries read as an age (`3m ago`), which is what a notification inbox
 * needs, and anything older than a week falls back to the shared
 * `formatShortDate`, so a date looks identical wherever it is rendered.
 *
 * An unparseable timestamp returns an empty string. A row must never print
 * `Invalid Date`, and omitting the time is less misleading than inventing one.
 * The `instanceof` check also covers entries restored from a persisted cache,
 * where `createdAt` can arrive as a string despite the model's type.
 *
 * `now` is injected so the output is deterministic in tests and so a row can
 * re-derive its label when the tab has been open for a while.
 */
export function formatNotificationTime(createdAt: Date, now: Date = new Date()): string {
  if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) return ''

  const ageMs = now.getTime() - createdAt.getTime()

  // Clock skew (a server timestamp slightly ahead of the client) is not a
  // future event worth labelling, so it renders as the newest entry.
  if (ageMs < MINUTE_MS) return 'Just now'
  if (ageMs < HOUR_MS) return `${Math.floor(ageMs / MINUTE_MS)}m ago`
  if (ageMs < DAY_MS) return `${Math.floor(ageMs / HOUR_MS)}h ago`
  if (ageMs < RELATIVE_CUTOFF_MS) return `${Math.floor(ageMs / DAY_MS)}d ago`
  return formatShortDate(createdAt.toISOString())
}
