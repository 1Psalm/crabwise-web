import type { NotificationType } from '@/types'

/**
 * Notification cache keys, scoped to the signed-in user.
 *
 * Notification pages are private: every key sits under `user/<id>`, so an
 * identity change selects a different entry instead of reusing the previous
 * account's cached inbox. A signed-out session uses the explicit
 * `signed-out` scope, which keeps those keys unique without a user.
 */
export const notificationKeys = {
  all: ['notifications'] as const,
  users: () => [...notificationKeys.all, 'user'] as const,
  user: (userId: string) => [...notificationKeys.users(), userId] as const,
  lists: (userId: string) => [...notificationKeys.user(userId), 'list'] as const,
  list: (userId: string, filters: NotificationFilters = {}) =>
    [...notificationKeys.lists(userId), filters] as const,
  unreadCount: (userId: string) => [...notificationKeys.user(userId), 'unreadCount'] as const,
}

/** Key scope used when there is no signed-in identity. */
export const SIGNED_OUT_SCOPE = 'signed-out'

/**
 * List filters. Kept as a plain object so it can be a stable part of a query
 * key: React Query hashes the key, and two calls with equal filters hit the
 * same cache entry.
 */
export interface NotificationFilters {
  /** Narrows to specific kinds; omitted or empty means every kind. */
  types?: readonly NotificationType[]
  /** Restricts to unread (`true`) or already-read (`false`) notifications. */
  read?: boolean
  page?: number
  pageSize?: number
}
