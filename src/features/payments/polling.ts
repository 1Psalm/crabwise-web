/**
 * Polling decisions for payment result / transaction status screens (#778).
 *
 * react-query v5 passes the `Query` object to the `refetchInterval`
 * callback — not the data — so every callback in this feature must read
 * `query.state.data`. The helpers are extracted here (a) to write the v5
 * access pattern once and (b) so the timing logic is testable without
 * mounting the screens.
 */

interface RefetchableQuery<T> {
  state: { data?: T }
}

/** Payment result statuses that mean the checkout is over. */
const TERMINAL_PAYMENT_RESULT_STATUSES = ['success', 'failed'] as const

type PaymentResultStatus = 'success' | 'failed'

/**
 * Poll the payment result every 5s until it reaches a terminal status.
 *
 * Both `success` and `failed` are terminal: a failed payment will not turn
 * into a successful one, so continuing to poll only burns requests (#64).
 */
export function paymentResultRefetchInterval(
  query: RefetchableQuery<{ status: PaymentResultStatus }>
): number | false {
  const status = query.state.data?.status
  if (status && (TERMINAL_PAYMENT_RESULT_STATUSES as readonly string[]).includes(status)) {
    return false
  }
  return 5000
}

type TxStatus = 'submitted' | 'confirming' | 'confirmed' | 'failed'

/** Transaction statuses that mean the transaction will not change again. */
const TERMINAL_TX_STATUSES: readonly TxStatus[] = ['confirmed', 'failed']

/** True once a transaction status can no longer change. */
export function isTerminalTxStatus(status: TxStatus | undefined): boolean {
  return status !== undefined && TERMINAL_TX_STATUSES.includes(status)
}

/**
 * Transaction status polling: the base interval before the first payload,
 * exponential backoff while pending (3s, 6s, 12s, 24s, max 30s), and no
 * interval once the transaction reaches `confirmed` or `failed`.
 *
 * When a caller passes `maxPollTime`, a transaction that is *still* pending
 * after that budget stops being polled instead of backing off forever (#799).
 */
export function txStatusRefetchInterval(
  query: RefetchableQuery<{ status: TxStatus }>,
  pollInterval: number,
  startTime: number,
  maxPollTime?: number
): number | false {
  const data = query.state.data
  if (!data) return pollInterval
  if (isTerminalTxStatus(data.status)) return false
  const elapsed = Date.now() - startTime
  if (maxPollTime !== undefined && elapsed > maxPollTime) return false
  return Math.min(pollInterval * Math.pow(2, Math.floor(elapsed / 15000)), 30000)
}

/**
 * Whether a poll loop should (re)start for the given transaction.
 *
 * Polling is bound to one transaction at a time: it runs only while that
 * transaction is known and not yet terminal. A new transaction hash is a new
 * poll loop, so the caller restarts polling by passing the new hash (#64).
 */
export function shouldPollTransaction(
  txHash: string | null | undefined,
  status: TxStatus | undefined
): boolean {
  if (!txHash) return false
  return !isTerminalTxStatus(status)
}
