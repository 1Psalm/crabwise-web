import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { http } from '@/services'
import { useWallet } from '@/features/auth/hooks/useWallet'
import { DISPLAY_FALLBACK_PRECISION, getAssetMeta } from '@/config'
import { paymentKeys } from './queryKeys'
import type { AssetBalance } from './walletBalances'

interface PaymentAssetSelectorProps {
  /** Artwork price in base asset (XLM) */
  price: string
  /** Assets accepted by the seller */
  acceptedAssets: string[]
  /** Called when user selects an asset */
  onSelect: (asset: string) => void
  /** Currently selected asset */
  selectedAsset: string
  /** Whether the selector is disabled */
  disabled?: boolean
}

export default function PaymentAssetSelector({
  price,
  acceptedAssets,
  onSelect,
  selectedAsset,
  disabled = false,
}: PaymentAssetSelectorProps) {
  const { publicKey } = useWallet()

  const {
    data: balances,
    isPending: balancesPending,
    isError: balancesError,
  } = useQuery({
    queryKey: paymentKeys.selectableAssets(publicKey),
    queryFn: async (): Promise<AssetBalance[]> => {
      if (!publicKey) return []
      const response = await http.get<{ balances: AssetBalance[] }>(
        `/wallets/${encodeURIComponent(publicKey)}/balances`,
      )
      return response.balances
    },
    enabled: !!publicKey,
  })

  const getUnavailableReason = (asset: string): string | null => {
    if (!acceptedAssets.includes(asset)) return 'This asset is not accepted by the seller.'
    if (!publicKey) return 'Connect your wallet to check this asset.'
    if (balancesError) return 'Could not verify your wallet balance. Try again before checkout.'
    if (balancesPending || !balances) return 'Checking your wallet balance.'

    const balance = balances.find((item) => item.asset === asset)
    if (!balance) return `No ${asset} balance was found in your wallet.`
    if (!balance.hasTrustline) return `Trustline missing for ${asset}. Add it in your wallet first.`
    if (parseFloat(balance.balance) < parseFloat(price)) {
      return `Insufficient ${asset} balance. Need ${price}, have ${balance.balance}.`
    }
    return null
  }

  const selectedAssetUnavailableReason = selectedAsset ? getUnavailableReason(selectedAsset) : null

  // Keep the current selection while a balance request is in flight. Clearing it during
  // that transient state makes the parent fall back to a different asset and can leave
  // the payment summary showing values for a selection the user did not make.
  useEffect(() => {
    if (
      selectedAsset &&
      selectedAssetUnavailableReason &&
      !(publicKey && (balancesPending || !balances))
    ) {
      onSelect('')
    }
  }, [
    selectedAsset,
    selectedAssetUnavailableReason,
    publicKey,
    balancesPending,
    balances,
    onSelect,
  ])

  const handleSelect = (asset: string) => {
    if (disabled || getUnavailableReason(asset)) return
    onSelect(asset)
  }

  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <fieldset className="min-w-0">
        <legend className="mb-2 block text-caption-sm font-medium text-foreground">Pay with</legend>

        <div className="flex flex-wrap items-center gap-2">
          {acceptedAssets.map((asset, index) => {
            const balance = balances?.find((b) => b.asset === asset)
            const precision = getAssetMeta(asset)?.precision ?? DISPLAY_FALLBACK_PRECISION
            const isSelected = selectedAsset === asset
            const unavailableReason = getUnavailableReason(asset)
            const reasonId = `payment-asset-unavailable-${index}`
            const isDisabled = disabled || !!unavailableReason

            return (
              <div key={asset} className="flex flex-col items-start gap-1">
                <button
                  type="button"
                  onClick={() => handleSelect(asset)}
                  disabled={isDisabled}
                  aria-describedby={unavailableReason ? reasonId : undefined}
                  className={`flex items-center gap-2 rounded-control px-3 py-2 text-caption-sm font-medium transition-colors ${
                    isSelected
                      ? 'bg-primary text-primary-contrast ring-2 ring-primary ring-offset-2 ring-offset-surface'
                      : 'bg-surface-muted text-foreground hover:bg-surface border border-line'
                  } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <span>{getAssetMeta(asset)?.label ?? asset}</span>
                  {balance && (
                    <span className="font-mono text-caption-xs text-muted">
                      {parseFloat(balance.balance).toLocaleString(undefined, {
                        minimumFractionDigits: precision,
                        maximumFractionDigits: precision,
                      })}
                    </span>
                  )}
                  {isSelected && (
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      aria-hidden="true"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
                {unavailableReason && (
                  <p id={reasonId} className="max-w-48 text-caption-xs text-muted" role="status">
                    {unavailableReason}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </fieldset>
    </div>
  )
}
