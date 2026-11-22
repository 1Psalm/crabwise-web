import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isTerminalTxStatus,
  paymentResultRefetchInterval,
  shouldPollTransaction,
  txStatusRefetchInterval,
} from './polling'

describe('paymentResultRefetchInterval (#778)', () => {
  it('keeps polling until the payment result is successful', () => {
    expect(paymentResultRefetchInterval({ state: { data: undefined } })).toBe(5000)
    expect(paymentResultRefetchInterval({ state: { data: { status: 'success' } } })).toBe(false)
  })

  it('stops polling at a terminal payment result status (#64)', () => {
    expect(paymentResultRefetchInterval({ state: { data: { status: 'failed' } } })).toBe(false)
  })
})

describe('txStatusRefetchInterval (#778)', () => {
  const START = 1_700_000_000_000

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the base interval before the first payload arrives', () => {
    expect(txStatusRefetchInterval({ state: { data: undefined } }, 3000, START)).toBe(3000)
  })

  it('stops polling at a terminal transaction status', () => {
    expect(
      txStatusRefetchInterval({ state: { data: { status: 'confirmed' } } }, 3000, START)
    ).toBe(false)
    expect(
      txStatusRefetchInterval({ state: { data: { status: 'failed' } } }, 3000, START)
    ).toBe(false)
  })

  it('backs off exponentially while the transaction is still pending', () => {
    const pending = { state: { data: { status: 'confirming' as const } } }

    // t+0s: 3s
    expect(txStatusRefetchInterval(pending, 3000, START)).toBe(3000)

    vi.setSystemTime(START + 15_000)
    // t+15s: 6s
    expect(txStatusRefetchInterval(pending, 3000, START)).toBe(6000)

    vi.setSystemTime(START + 30_000)
    // t+30s: 12s
    expect(txStatusRefetchInterval(pending, 3000, START)).toBe(12_000)

    vi.setSystemTime(START + 45_000)
    // t+45s: 24s
    expect(txStatusRefetchInterval(pending, 3000, START)).toBe(24_000)

    vi.setSystemTime(START + 60_000)
    // t+60s: 48s would exceed the 30s cap
    expect(txStatusRefetchInterval(pending, 3000, START)).toBe(30_000)
  })
})

describe('txStatusRefetchInterval max poll time (#799)', () => {
  const START = 1_700_000_000_000
  const MAX_POLL_TIME = 5 * 60 * 1000
  const pending = { state: { data: { status: 'confirming' as const } } }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps polling while the caller\'s budget is not spent', () => {
    vi.setSystemTime(START + MAX_POLL_TIME)

    expect(txStatusRefetchInterval(pending, 3000, START, MAX_POLL_TIME)).toBe(30_000)
  })

  it('stops polling once the budget is spent', () => {
    vi.setSystemTime(START + MAX_POLL_TIME + 1)

    expect(txStatusRefetchInterval(pending, 3000, START, MAX_POLL_TIME)).toBe(false)
  })

  it('stops at a terminal status even inside the budget', () => {
    expect(
      txStatusRefetchInterval({ state: { data: { status: 'confirmed' } } }, 3000, START, MAX_POLL_TIME)
    ).toBe(false)
  })
})

describe('isTerminalTxStatus (#64)', () => {
  it('treats confirmed and failed as terminal', () => {
    expect(isTerminalTxStatus('confirmed')).toBe(true)
    expect(isTerminalTxStatus('failed')).toBe(true)
  })

  it('treats submitted, confirming and unknown as non-terminal', () => {
    expect(isTerminalTxStatus('submitted')).toBe(false)
    expect(isTerminalTxStatus('confirming')).toBe(false)
    expect(isTerminalTxStatus(undefined)).toBe(false)
  })
})

describe('shouldPollTransaction (#64)', () => {
  it('polls while the transaction is not terminal', () => {
    expect(shouldPollTransaction('abc', undefined)).toBe(true)
    expect(shouldPollTransaction('abc', 'submitted')).toBe(true)
    expect(shouldPollTransaction('abc', 'confirming')).toBe(true)
  })

  it('stops polling once the transaction reaches a terminal status', () => {
    expect(shouldPollTransaction('abc', 'confirmed')).toBe(false)
    expect(shouldPollTransaction('abc', 'failed')).toBe(false)
  })

  it('does not poll without a transaction hash', () => {
    expect(shouldPollTransaction(null, 'confirming')).toBe(false)
    expect(shouldPollTransaction(undefined, undefined)).toBe(false)
  })

  it('restarts polling for a new transaction after a terminal one', () => {
    const firstTx = 'tx-first'
    const secondTx = 'tx-second'

    // The first transaction finished, so its poll loop is over.
    expect(shouldPollTransaction(firstTx, 'confirmed')).toBe(false)
    // A new transaction hash starts a fresh poll loop.
    expect(shouldPollTransaction(secondTx, undefined)).toBe(true)
    expect(shouldPollTransaction(secondTx, 'submitted')).toBe(true)
  })
})
