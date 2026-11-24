/**
 * Polling decisions for the order confirmation screen (#778, #75, #73).
 *
 * react-query v5 passes the `Query` object to the `refetchInterval`
 * callback — not the data. Polling is bounded to avoid indefinite requests.
 */

interface RefetchableQuery<T> {
  state: { data?: T; dataUpdateCount?: number }
}

export const ORDER_POLL_INTERVAL_MS = 3000
export const ORDER_POLL_MAX_UPDATES = 40 // ~2 minutes at 3s interval

export type OrderStatus = 'confirming' | 'confirmed' | 'failed'
export type OrderScreenState = 'loading' | 'confirming' | 'confirmed' | 'failed' | 'timed_out'

export function isOrderPollingTimedOut(
  query: RefetchableQuery<{ status: OrderStatus }>,
): boolean {
  const status = query.state.data?.status
  const updates = query.state.dataUpdateCount ?? 0
  return status === 'confirming' && updates >= ORDER_POLL_MAX_UPDATES
}

export function getOrderScreenState(
  query: RefetchableQuery<{ status: OrderStatus }> | undefined,
  isPending: boolean,
): OrderScreenState {
  if (isPending || !query?.state.data) return 'loading'
  if (isOrderPollingTimedOut(query)) return 'timed_out'
  return query.state.data.status
}

export function orderRefetchInterval(
  query: RefetchableQuery<{ status: OrderStatus }>,
): number | false {
  if (query.state.data?.status !== 'confirming') return false
  if (isOrderPollingTimedOut(query)) return false
  return ORDER_POLL_INTERVAL_MS
}
