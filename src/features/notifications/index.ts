/**
 * Notifications feature.
 *
 * In-app notifications and alerts.
 * This barrel is the feature's public API; everything else stays private.
 */
export {
  NOTIFICATION_ACTION_FOCUS_CLASSES,
  notificationActions,
  notificationErrorState,
  useMarkAllNotificationsRead,
  useNotifications,
  useSetNotificationRead,
  useUnreadCount,
} from './hooks/useNotifications'
export type { NotificationErrorState } from './hooks/useNotifications'
export { notificationApi } from './services/notificationApi'
export { notificationKeys } from './queryKeys'
export type { NotificationFilters } from './queryKeys'
export {
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
  normalizeUnreadCount,
  notificationKind,
  notificationKindMeta,
  notificationTarget,
  unreadBadgeLabel,
  unreadIds,
} from './utils'
