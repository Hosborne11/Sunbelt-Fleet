// Straight-line depreciation. Returns null if there isn't enough data to compute.
export function bookValue(asset) {
  const { purchase_price, purchase_date, useful_life_years, salvage_value } = asset
  if (purchase_price == null || !purchase_date || !useful_life_years) return null

  const salvage = salvage_value ?? 0
  const depreciableBase = purchase_price - salvage
  const yearsOwned = (Date.now() - new Date(purchase_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  const annualDepreciation = depreciableBase / useful_life_years
  const accumulated = Math.min(annualDepreciation * Math.max(yearsOwned, 0), depreciableBase)

  return {
    currentValue: Math.max(purchase_price - accumulated, salvage),
    accumulatedDepreciation: accumulated,
    percentDepreciated: depreciableBase > 0 ? (accumulated / depreciableBase) * 100 : 0,
    yearsOwned,
  }
}

export function formatCurrency(n) {
  if (n == null) return '—'
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}
