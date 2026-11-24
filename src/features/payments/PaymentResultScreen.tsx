import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, ExplorerLink, Spinner } from '@/components/ui'
import { http } from '@/services'
import { formatDate, safeExternalUrl } from '@/lib'
import { paymentResultRefetchInterval } from './polling'

interface PaymentResultData {
  id: string
  status: 'success' | 'failed'
  artworkTitle: string
  artworkThumbnail?: string
  sellerName: string
  /** Real profile handle for the seller link — never slugify the display name. */
  sellerUsername?: string
  amount: string
  asset: string
  platformFee: string
  networkFee: string
  total: string
  txHash: string | null
  failureReason?: string
  failureCategory?: 'rejected' | 'insufficient_funds' | 'network' | 'timeout' | 'unknown'
  deliverables?: Deliverable[]
  createdAt: string
  checkoutSessionId: string
}

interface Deliverable {
  id: string
  name: string
  url: string
  expiresAt: string
}

const FAILURE_REMEDIES: Record<
  string,
  { title: string; description: string; actionLabel: string; action: () => void }
> = {
  rejected: {
    title: 'Transaction Rejected',
    description: 'You cancelled the transaction in your wallet. No funds were transferred.',
    actionLabel: 'Try Again',
    action: () => {},
  },
  insufficient_funds: {
    title: 'Insufficient Funds',
    description: 'Your wallet does not have enough balance to cover the payment and fees.',
    actionLabel: 'Add Funds',
    action: () => {},
  },
  network: {
    title: 'Network Error',
    description: 'The Stellar network is experiencing issues. Please try again in a few minutes.',
    actionLabel: 'Retry',
    action: () => {},
  },
  timeout: {
    title: 'Transaction Timeout',
    description: 'The transaction took too long to confirm. It may still be processing.',
    actionLabel: 'Check Status',
    action: () => {},
  },
  unknown: {
    title: 'Payment Failed',
    description: 'An unexpected error occurred. Please try again or contact support.',
    actionLabel: 'Retry',
    action: () => {},
  },
}

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

function isValidSessionId(value: string | null): value is string {
  return typeof value === 'string' && SESSION_ID_RE.test(value.trim())
}

export default function PaymentResultScreen() {
  const [searchParams] = useSearchParams()
  const rawSessionId = searchParams.get('sessionId')
  const sessionId = rawSessionId?.trim() ?? null
  const validSessionId = isValidSessionId(sessionId)
  const [showConfetti, setShowConfetti] = useState(false)
  const queryClient = useQueryClient()

  const {
    data: result,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['paymentResult', sessionId],
    queryFn: async (): Promise<PaymentResultData> => {
      if (!validSessionId || !sessionId) throw new Error('Invalid session ID')
      const response = await http.get<{ result: PaymentResultData }>(
        `/payments/result/${encodeURIComponent(sessionId)}`,
        { skipToast: true },
      )
      return response.result
    },
    enabled: validSessionId,
    refetchInterval: paymentResultRefetchInterval,
  })

  // React Query may briefly retain observer data while a query key changes.
  // Never render that data unless the API confirms it belongs to this session.
  const currentResult = result?.checkoutSessionId === sessionId ? result : undefined

  useEffect(() => {
    if (currentResult?.status === 'success' && !showConfetti) {
      setShowConfetti(true)
    }
  }, [currentResult?.status, showConfetti])

  useEffect(() => {
    if (result?.status === 'success') {
      // Refresh balance data only after a confirmed payment.
      queryClient.invalidateQueries({ queryKey: ['walletBalances'] })
      queryClient.invalidateQueries({ queryKey: ['artistBalances'] })
    }
  }, [queryClient, result?.status])

  if (!validSessionId) {
    return (
      <div className="container py-24 text-center">
        <h1 className="text-h2">Invalid payment link</h1>
        <p className="mt-2 text-caption text-muted">
          The payment session ID is missing or invalid. Please open the payment result from your purchases or return home for safe recovery.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button asChild>
            <Link to="/purchases">Go to purchases</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link to="/">Go home</Link>
          </Button>
        </div>
      </div>
    )
  }

  if (isPending || !currentResult) {
    return (
      <div className="container py-24 text-center">
        <div className="flex flex-col items-center gap-4">
          <Spinner className="h-10 w-10" />
          <p className="text-caption text-muted">Loading payment result…</p>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="container py-24 text-center">
        <div className="flex flex-col items-center gap-4">
          <svg
            className="h-16 w-16 text-danger"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <h1 className="text-h2">Failed to load result</h1>
          <p className="text-caption text-muted">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
          <Button className="mt-4" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  const isSuccess = currentResult.status === 'success'
  const remedy = currentResult.failureCategory
    ? FAILURE_REMEDIES[currentResult.failureCategory]
    : FAILURE_REMEDIES.unknown

  return (
    <div className="container py-12">
      <div className="max-w-2xl mx-auto">
        {showConfetti && isSuccess && (
          <div
            className="fixed inset-0 pointer-events-none z-50 overflow-hidden"
            aria-hidden="true"
          >
            <Confetti />
          </div>
        )}

        <div
          className={`rounded-card border border-line bg-surface p-8 shadow-card text-center ${isSuccess ? '' : 'border-danger/30'}`}
        >
          {isSuccess ? (
            <>
              <div className="flex justify-center mb-6">
                <div className="h-16 w-16 rounded-full bg-success/10 flex items-center justify-center">
                  <svg
                    className="h-8 w-8 text-success"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              </div>
              <h1 className="text-h2">Payment Successful!</h1>
              <p className="mt-2 text-caption text-muted">
                Your purchase of <strong>{currentResult.artworkTitle}</strong> has been confirmed
                on-chain.
              </p>

              <div className="mt-6 rounded-card bg-surface-muted p-4 text-left">
                <h3 className="text-caption-sm font-semibold text-foreground">Order Summary</h3>
                <div className="mt-3 space-y-2 text-caption-sm">
                  <div className="flex justify-between">
                    <span className="text-muted">Artwork</span>
                    <span>{currentResult.artworkTitle}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Seller</span>
                    <span>{currentResult.sellerName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Amount</span>
                    <span className="font-mono">
                      {currentResult.amount} {currentResult.asset}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Platform fee</span>
                    <span className="font-mono">
                      {currentResult.platformFee} {currentResult.asset}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Network fee</span>
                    <span className="font-mono">
                      {currentResult.networkFee} {currentResult.asset}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-line pt-2">
                    <span className="font-semibold">Total</span>
                    <span className="font-bold font-mono">
                      {currentResult.total} {currentResult.asset}
                    </span>
                  </div>
                </div>
              </div>

              {currentResult.txHash && (
                <div className="mt-4 p-3 rounded-control bg-surface-muted">
                  <p className="text-caption-xs text-muted">Transaction Hash</p>
                  <ExplorerLink value={currentResult.txHash} type="tx" />
                </div>
              )}

              {currentResult.deliverables && currentResult.deliverables.length > 0 && (
                <div className="mt-6 rounded-card border border-line bg-surface p-4 shadow-card text-left">
                  <h3 className="text-caption-sm font-semibold text-foreground">
                    Your Deliverables
                  </h3>
                  <p className="mt-1 text-caption text-muted">
                    Download links expire on {formatDate(currentResult.deliverables[0].expiresAt)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {currentResult.deliverables.map((d) => {
                      const url = safeExternalUrl(d.url)
                      return url ? (
                        <Button key={d.id} size="sm" variant="secondary" asChild>
                          <a href={url} target="_blank" rel="noreferrer">
                            Download {d.name}
                          </a>
                        </Button>
                      ) : (
                        <span
                          key={d.id}
                          className="rounded-control border border-line bg-surface-muted px-3 py-1.5 text-caption-sm text-muted"
                        >
                          {d.name} (link unavailable)
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
                {currentResult.sellerUsername ? (
                  <Button asChild>
                    <Link to={`/artists/${encodeURIComponent(currentResult.sellerUsername)}`}>
                      View Seller Profile
                    </Link>
                  </Button>
                ) : null}
                <Button variant="secondary" asChild>
                  <Link to="/purchases">View All Purchases</Link>
                </Button>
              </div>

              <p className="mt-4 text-caption-xs text-muted">
                A receipt has been sent to your email.
              </p>
            </>
          ) : (
            <>
              <div className="flex justify-center mb-6">
                <div className="h-16 w-16 rounded-full bg-danger/10 flex items-center justify-center">
                  <svg
                    className="h-8 w-8 text-danger"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                </div>
              </div>
              <h1 className="text-h2">{remedy.title}</h1>
              <p className="mt-2 text-caption text-muted">
                Your purchase of <strong>{currentResult.artworkTitle}</strong> could not be
                completed.
              </p>

              <div className="mt-4 rounded-control bg-danger/10 p-4 text-left">
                <p className="text-caption-sm font-semibold text-danger">{remedy.description}</p>
                {currentResult.failureReason && (
                  <p className="mt-1 text-caption text-foreground">{currentResult.failureReason}</p>
                )}
              </div>

              <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
                <Button onClick={() => window.history.back()}>{remedy.actionLabel}</Button>
                <Button variant="secondary" asChild>
                  <Link to="/">Go Home</Link>
                </Button>
              </div>

              <p className="mt-4 text-caption-xs text-muted">
                You were not charged. The checkout session is preserved for retry.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Confetti() {
  const particles = useMemo(
    () =>
      Array.from({ length: 50 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: -10 - Math.random() * 50,
        size: 6 + Math.random() * 8,
        color: ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A'][
          Math.floor(Math.random() * 5)
        ],
        rotation: Math.random() * 360,
        duration: 3 + Math.random() * 2,
      })),
    [],
  )

  return (
    <>
      {particles.map((p) => (
        <div
          key={p.id}
          className="fixed pointer-events-none"
          style={{
            left: `${p.x}vw`,
            top: `${p.y}vh`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            backgroundColor: p.color,
            transform: `rotate(${p.rotation}deg)`,
            animation: `fall ${p.duration}s linear forwards`,
          }}
        />
      ))}
    </>
  )
}
