import { useCallback, useRef, useState } from 'react'
import { isApiError } from '@/services/http'

export interface UseFormSubmissionOptions {
  /**
   * How long (ms) to keep the submit control disabled after a successful
   * submission. Defaults to 2500 ms (#937).
   */
  cooldownMs?: number
}

/**
 * Categorises a caught submission error so the UI can announce it
 * accessibly without coupling to raw error codes (#145).
 *
 * - `'validation'` — the server returned field-level errors (HTTP 422 /
 *   `VALIDATION_FAILED`).  The form should focus the first invalid field.
 * - `'network'`    — the request never reached the server or the server
 *   was unreachable (`NETWORK_ERROR`, `TIMEOUT`).  The form should suggest
 *   checking the connection.
 * - `'other'`      — any other server-side error (4xx/5xx with an error
 *   code, or an unexpected thrown value).
 */
export type SubmissionErrorKind = 'validation' | 'network' | 'other'

export interface SubmissionError {
  /** Human-readable message, taken from `ApiError.message` when possible. */
  readonly message: string
  /** The original thrown value, preserved for callers that need to inspect field errors. */
  readonly cause: unknown
  /** Coarse category so the UI can render the right accessible announcement. */
  readonly kind: SubmissionErrorKind
}

export interface UseFormSubmissionResult<TArgs extends unknown[]> {
  /** True while the async submit handler is running or during cooldown. */
  isSubmitting: boolean
  /** Label helpers can use for the button (\"Submitting…\" vs default). */
  submitLabel: (idle: string) => string
  /**
   * Wrap an async submit handler. Concurrent calls are ignored while a
   * submission is already in flight.
   *
   * On failure the original error is re-thrown so callers can react to it,
   * and `submissionError` is populated with a categorised snapshot (#145).
   */
  runSubmit: (...args: TArgs) => Promise<void>
  /** Force-clear submitting/cooldown state (e.g. on unmount of a modal). */
  reset: () => void
  /**
   * The most recent submission error, or `null` when the hook is idle /
   * the last submission succeeded.  Cleared by `reset()` or a new successful
   * submission (#145).
   */
  submissionError: SubmissionError | null
  /** Re-runs the last submission with the same inputs so users can retry (#139). */
  retry: () => Promise<void>
}

/** Derives the coarse error kind from a caught value. */
function classifyError(err: unknown): SubmissionErrorKind {
  if (isApiError(err)) {
    if (err.code === 'VALIDATION_FAILED' || err.status === 422) return 'validation'
    if (err.code === 'NETWORK_ERROR' || err.code === 'TIMEOUT' || err.status === null)
      return 'network'
    return 'other'
  }
  return 'other'
}

/** Extracts the best available user-facing message from a caught value. */
function messageFrom(err: unknown): string {
  if (isApiError(err)) return err.message
  if (err instanceof Error) return err.message
  return 'An unexpected error occurred.'
}

/**
 * Prevents double form submissions (#937) and surfaces distinct, accessibly
 * announceable error state (#145).
 *
 * - Sets `isSubmitting` for the duration of the handler.
 * - Keeps the control disabled for `cooldownMs` after success so a
 *   rapid second click cannot re-fire the action.
 * - Concurrent calls while in-flight are no-ops.
 * - On failure the original error is re-thrown (not `undefined`) and
 *   `submissionError` is set with a categorised `SubmissionError`.
 */
export function useFormSubmission<TArgs extends unknown[] = []>(
  handler: (...args: TArgs) => Promise<void>,
  options: UseFormSubmissionOptions = {},
): UseFormSubmissionResult<TArgs> {
  const cooldownMs = options.cooldownMs ?? 2_500
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submissionError, setSubmissionError] = useState<SubmissionError | null>(null)
  const inFlight = useRef(false)
  const lastArgs = useRef<TArgs | null>(null)
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reset = useCallback(() => {
    inFlight.current = false
    setIsSubmitting(false)
    setSubmissionError(null)
    if (cooldownTimer.current) {
      clearTimeout(cooldownTimer.current)
      cooldownTimer.current = null
    }
  }, [])

  const runSubmit = useCallback(
    async (...args: TArgs) => {
      if (inFlight.current) return
      inFlight.current = true
      lastArgs.current = args
      setIsSubmitting(true)
      // Keep the previous error visible until a submission succeeds (#139).
      try {
        await handler(...args)
        setSubmissionError(null)
        // Success cooldown — keep disabled briefly so double-clicks after
        // the network resolves still cannot re-submit.
        cooldownTimer.current = setTimeout(() => {
          inFlight.current = false
          setIsSubmitting(false)
          cooldownTimer.current = null
        }, cooldownMs)
      } catch (err) {
        // On failure, re-enable immediately so the user can retry.
        inFlight.current = false
        setIsSubmitting(false)
        setSubmissionError({
          message: messageFrom(err),
          cause: err,
          kind: classifyError(err),
        })
        // Re-throw the original error so callers can inspect ApiError field
        // errors, log unexpected failures, etc. (#145)
        throw err
      }
    },
    [cooldownMs, handler],
  )

  const retry = useCallback(async () => {
    if (lastArgs.current) await runSubmit(...lastArgs.current)
  }, [runSubmit])

  const submitLabel = useCallback(
    (idle: string) => (isSubmitting ? 'Submitting…' : idle),
    [isSubmitting],
  )

  return { isSubmitting, submitLabel, runSubmit, reset, submissionError, retry }
}
