import { useEffect } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getErrorMessage, isApiError } from '@/services/http'
import { onSessionReset, useAuthStore } from '@/features/auth/stores/useAuthStore'
import { notificationApi } from '../services/notificationApi'
import { SIGNED_OUT_SCOPE, notificationKeys, type NotificationFilters } from '../queryKeys'
import { UNREAD_POLL_INTERVAL_MS, adjustUnreadCount, applyReadToPages } from '../utils'
import type { Notification, Paginated } from '@/types'

/**
 * Drops every cached notification page when the session ends or changes.
 *
 * Notification data belongs to the signed-in user: leaving it in the cache
 * would show the previous account's inbox to the next user, or to the same
 * user after a sign-out. Removing the queries is synchronous with
 * `clearSession` / `setSession`, so the list cannot paint stale rows first.
 * The per-identity key scope below is the second line of defence: even a cache
 * entry that outlives the reset is never read by the next identity.
 */
function useNotificationSessionReset(): void {
  const queryClient = useQueryClient()

  useEffect(
    () =>
      onSessionReset(() => {
        queryClient.removeQueries({ queryKey: notificationKeys.all })
      }),
    [queryClient],
  )
}

/**
 * Identity that owns the cached pages.
 *
 * Every notification key is built from this scope, so signing in as a
 * different account selects a different cache entry instead of reusing the
 * previous user's inbox. Signed-out callers get an explicit, distinct scope.
 */
function useNotificationScope(): string {
  return useAuthStore((state) => state.user?.id ?? SIGNED_OUT_SCOPE)
}

/** Whether the session is usable for authenticated requests. */
function useHasSession(): boolean {
  return useAuthStore((state) => state.status === 'authenticated')
}

/**
 * Accessible names for the notification actions (#106).
 *
 * Build the visible label and the accessible name together so a button can
 * never end up as an unlabelled icon, and apply `NOTIFICATION_ACTION_FOCUS_CLASSES`
 * so keyboard focus is always visible.
 */
export const NOTIFICATION_ACTION_FOCUS_CLASSES =
  'rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background'

export const notificationActions = {
  /** Opens the notification's target. */
  open: (title: string) => ({ label: 'Open', ariaLabel: `Open notification: ${title}` }),
  /** Toggles the read flag; the label describes the action, not the state. */
  toggleRead: (title: string, read: boolean) => ({
    label: read ? 'Mark unread' : 'Mark read',
    ariaLabel: `${read ? 'Mark unread' : 'Mark read'}: ${title}`,
  }),
  /** Marks every notification in the inbox read. */
  markAllRead: () => ({ label: 'Mark all read', ariaLabel: 'Mark all notifications as read' }),
  /** Re-runs a failed notification request. */
  retry: () => ({ label: 'Retry', ariaLabel: 'Retry loading notifications' }),
} as const

/**
 * One page of notifications.
 *
 * `keepPreviousData` keeps the current page visible while the next one loads,
 * so paginating does not flash an empty list. The query stays disabled while
 * signed out, so a signed-out mount cannot fetch or render a user's inbox.
 */
export function useNotifications(filters: NotificationFilters = {}) {
  useNotificationSessionReset()
  const scope = useNotificationScope()
  const enabled = useHasSession()

  return useQuery({
    queryKey: notificationKeys.list(scope, filters),
    queryFn: () => notificationApi.list(filters),
    placeholderData: keepPreviousData,
    enabled,
  })
}

/**
 * Unread total for the badge.
 *
 * Polls inside the 30s freshness budget, and only while the tab is visible, so
 * a backgrounded tab does not keep hitting the API.
 */
export function useUnreadCount() {
  useNotificationSessionReset()
  const scope = useNotificationScope()
  const enabled = useHasSession()

  return useQuery({
    queryKey: notificationKeys.unreadCount(scope),
    queryFn: () => notificationApi.unreadCount(),
    refetchInterval: UNREAD_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    enabled,
  })
}

/**
 * Props for the notification error state.
 *
 * A failed fetch is a failure, not an empty inbox: callers render this instead
 * of the empty state, and wire `onRetry` to the query's `refetch` so the retry
 * button is always present and always re-runs the same request.
 */
export interface NotificationErrorState {
  title: string
  message: string
  retryLabel: string
  code?: string
}

export function notificationErrorState(error: unknown): NotificationErrorState {
  const message = isApiError(error)
    ? getErrorMessage(error)
    : 'Check your connection and try again.'
  return {
    title: "Couldn't load notifications",
    message,
    retryLabel: notificationActions.retry().label,
    ...(isApiError(error) && error.code ? { code: error.code } : {}),
  }
}

/**
 * Marks one notification read or unread, optimistically.
 *
 * The write is applied to every cached list page and to the unread total
 * before the request resolves, so the badge and the list never disagree. A
 * failure rolls the cache back to the snapshot rather than leaving the UI in
 * the optimistic state.
 */
export function useSetNotificationRead() {
  const queryClient = useQueryClient()
  useNotificationSessionReset()
  const scope = useNotificationScope()

  return useMutation({
    mutationFn: ({ id, read }: { id: string; read: boolean }) => notificationApi.setRead(id, read),

    onMutate: async ({ id, read }) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.lists(scope) })

      const previousLists = queryClient.getQueriesData<Paginated<Notification>>({
        queryKey: notificationKeys.lists(scope),
      })
      const previousUnread = queryClient.getQueryData<{ count: number }>(
        notificationKeys.unreadCount(scope),
      )

      for (const [key, page] of previousLists) {
        if (!page) continue
        queryClient.setQueryData(key, applyReadToPages([page], [id], read)[0])
      }

      if (previousUnread) {
        const pages = previousLists
          .map(([, page]) => page)
          .filter((page): page is Paginated<Notification> => Boolean(page))
        queryClient.setQueryData(notificationKeys.unreadCount(scope), {
          count: adjustUnreadCount(previousUnread.count, pages, [id], read),
        })
      }

      return { previousLists, previousUnread }
    },

    onError: (_error, _variables, context) => {
      for (const [key, page] of context?.previousLists ?? []) {
        queryClient.setQueryData(key, page)
      }
      if (context?.previousUnread) {
        queryClient.setQueryData(notificationKeys.unreadCount(scope), context.previousUnread)
      }
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all })
    },
  })
}

/**
 * Marks every notification read.
 *
 * The cached pages are cleared of unread entries immediately and the count is
 * zeroed optimistically, then both are rolled back if the request fails.
 */
export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient()
  useNotificationSessionReset()
  const scope = useNotificationScope()

  return useMutation({
    mutationFn: () => notificationApi.markAllRead(),

    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.lists(scope) })

      const previousLists = queryClient.getQueriesData<Paginated<Notification>>({
        queryKey: notificationKeys.lists(scope),
      })
      const previousUnread = queryClient.getQueryData<{ count: number }>(
        notificationKeys.unreadCount(scope),
      )

      for (const [key, page] of previousLists) {
        if (!page) continue
        queryClient.setQueryData(
          key,
          applyReadToPages(
            [page],
            page.items
              .filter((notification) => !notification.read)
              .map((notification) => notification.id),
            true,
          )[0],
        )
      }

      if (previousUnread) {
        queryClient.setQueryData(notificationKeys.unreadCount(scope), { count: 0 })
      }

      return { previousLists, previousUnread }
    },

    onError: (_error, _variables, context) => {
      for (const [key, page] of context?.previousLists ?? []) {
        queryClient.setQueryData(key, page)
      }
      if (context?.previousUnread) {
        queryClient.setQueryData(notificationKeys.unreadCount(scope), context.previousUnread)
      }
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all })
    },
  })
}
