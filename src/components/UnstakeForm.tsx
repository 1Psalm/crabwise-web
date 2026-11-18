import { useState, type FormEvent } from 'react'
import { Button, Input, Modal } from '@/components/ui'
import { useStellarBalance, validateStakeBalance, requireBalance } from '@/hooks/useStellarBalance'

/** Formats a token amount without trailing float noise (e.g. 0.30000000000000004). */
function formatAmount(value: number): string {
  return String(Number(value.toFixed(7)))
}

export interface UnstakeFormProps {
  /** User's current staked balance eligible for unstaking. */
  stakedBalance?: string | number
  /** Asset identifier (e.g., 'XLM', 'AID'). Defaults to 'XLM'. */
  asset?: string
  /** Display unit for balance and error messages (defaults to 'tokens'). */
  unit?: string
  /** Async callback invoked when unstaking transaction is submitted and validated. */
  onUnstake?: (amount: string) => Promise<void>
  /** Callback fired upon successful unstake execution. */
  onSuccess?: () => void
  /** Callback fired upon failure or validation error. */
  onError?: (error: string) => void
  /** Additional CSS class names */
  className?: string
}

/**
 * Unstaking form with strict pre-transaction balance validation (#941) and a
 * confirmation step before the transaction is signed (#143).
 * Prevents users from unstaking more tokens than their active staked balance,
 * and makes the consequences of unstaking explicit so a mis-click cannot start
 * a transaction.
 */
export default function UnstakeForm({
  stakedBalance: propStakedBalance,
  asset = 'XLM',
  unit = 'tokens',
  onUnstake,
  onSuccess,
  onError,
  className = '',
}: UnstakeFormProps) {
  const { stakedBalance: hookStakedBalance } = useStellarBalance({
    asset,
    initialStakedBalance: propStakedBalance,
  })

  const effectiveStakedBalance =
    propStakedBalance !== undefined ? String(propStakedBalance) : hookStakedBalance

  const [amount, setAmount] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [isSuccess, setIsSuccess] = useState<boolean>(false)
  // Amount awaiting confirmation; `null` keeps the dialog closed.
  const [pendingAmount, setPendingAmount] = useState<string | null>(null)

  const handleMaxClick = () => {
    setAmount(effectiveStakedBalance)
    setError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pendingAmount !== null || isSubmitting) return
    setIsSuccess(false)

    // 1. Validate balance before transaction (#941)
    const validation = validateStakeBalance(amount, effectiveStakedBalance, {
      action: 'unstake',
      unit,
    })

    if (!validation.isValid) {
      const errorMsg = validation.error ?? 'Insufficient balance.'
      setError(errorMsg)
      onError?.(errorMsg)
      return
    }

    // 2. Double-check guard constraint
    try {
      requireBalance(effectiveStakedBalance, amount, { action: 'unstake', unit })
    } catch (guardErr) {
      const guardMsg = guardErr instanceof Error ? guardErr.message : 'Insufficient balance'
      setError(guardMsg)
      onError?.(guardMsg)
      return
    }

    // 3. Ask the user to confirm the consequences before signing (#143).
    //    No transaction is started until the dialog is confirmed.
    setError(null)
    setPendingAmount(amount)
  }

  const handleCancelConfirmation = () => {
    setPendingAmount(null)
  }

  const handleConfirmUnstake = async () => {
    if (pendingAmount === null) return

    const confirmedAmount = pendingAmount
    setIsSubmitting(true)

    try {
      if (onUnstake) {
        await onUnstake(confirmedAmount)
      }
      setIsSuccess(true)
      onSuccess?.()
    } catch (err) {
      const failureMsg = err instanceof Error ? err.message : 'Unstaking transaction failed'
      setError(failureMsg)
      onError?.(failureMsg)
    } finally {
      setIsSubmitting(false)
      // Close only after the flow settles so the dialog is not left behind on error.
      setPendingAmount(null)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className={`flex flex-col gap-4 ${className}`}>
      <div className="flex items-center justify-between text-caption text-muted">
        <span>Staked balance:</span>
        <div className="flex items-center gap-2">
          <strong className="font-mono text-foreground" data-testid="staked-balance">
            {effectiveStakedBalance} {unit}
          </strong>
          <button
            type="button"
            onClick={handleMaxClick}
            className="text-primary text-caption-sm font-semibold hover:underline"
            data-testid="unstake-max-btn"
          >
            Max
          </button>
        </div>
      </div>

      <Input
        label="Unstake amount"
        name="amount"
        type="number"
        step="any"
        min="0"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.0"
        value={amount}
        error={error}
        hint={`Enter up to ${effectiveStakedBalance} ${unit}`}
        onChange={(e) => {
          setAmount(e.target.value)
          if (error) setError(null)
        }}
        data-testid="unstake-amount-input"
      />

      {isSuccess ? (
        <p role="status" className="text-caption text-success" data-testid="unstake-success-msg">
          Successfully unstaked {amount} {unit}!
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={isSubmitting}
        variant="secondary"
        className="w-full justify-center"
        data-testid="unstake-submit-btn"
      >
        {isSubmitting ? 'Unstaking...' : 'Unstake Tokens'}
      </Button>

      <Modal
        isOpen={pendingAmount !== null}
        title="Confirm unstake"
        description="Review what happens before you sign this transaction."
        onClose={handleCancelConfirmation}
      >
        <div className="flex flex-col gap-4" data-testid="unstake-confirmation">
          <p className="text-body text-foreground">
            You are about to unstake{' '}
            <strong className="font-semibold">
              {pendingAmount} {unit}
            </strong>
            .
          </p>

          <ul className="flex flex-col gap-2 text-caption text-muted">
            <li>
              Staked balance after unstaking:{' '}
              <strong className="font-mono text-foreground">
                {pendingAmount !== null
                  ? formatAmount(Number(effectiveStakedBalance) - Number(pendingAmount))
                  : effectiveStakedBalance}{' '}
                {unit}
              </strong>
            </li>
            <li>Staking rewards stop accruing on the unstaked amount.</li>
            <li>The unstaked tokens become available to withdraw after the unbonding period.</li>
            <li>This request cannot be cancelled once the transaction is signed.</li>
          </ul>

          <p className="text-caption-sm text-muted">
            Nothing is sent to your wallet until you choose &ldquo;Confirm unstake&rdquo;.
          </p>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={handleCancelConfirmation}
              disabled={isSubmitting}
              data-testid="unstake-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleConfirmUnstake}
              isLoading={isSubmitting}
              data-testid="unstake-confirm-btn"
            >
              Confirm unstake
            </Button>
          </div>
        </div>
      </Modal>
    </form>
  )
}
