const DUE_SOON_HOURS = 50
const DUE_SOON_DAYS = 14

// Returns { hoursRemaining, dueDate, daysRemaining, status } where status is
// 'overdue' | 'due_soon' | 'ok' | 'unknown' (not enough data to compute).
export function computeDue(plan, assetHourMeter) {
  let hoursRemaining = null
  let daysRemaining = null
  let dueDate = null

  if (plan.interval_hours != null && plan.last_service_hours != null && assetHourMeter != null) {
    const dueAt = plan.last_service_hours + plan.interval_hours
    hoursRemaining = dueAt - assetHourMeter
  }

  if (plan.interval_days != null && plan.last_service_date) {
    const d = new Date(plan.last_service_date)
    d.setDate(d.getDate() + plan.interval_days)
    dueDate = d.toISOString().slice(0, 10)
    daysRemaining = Math.round((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  }

  if (hoursRemaining == null && daysRemaining == null) {
    return { hoursRemaining, daysRemaining, dueDate, status: 'unknown' }
  }

  const overdue =
    (hoursRemaining != null && hoursRemaining <= 0) || (daysRemaining != null && daysRemaining <= 0)
  const dueSoon =
    (hoursRemaining != null && hoursRemaining <= DUE_SOON_HOURS) ||
    (daysRemaining != null && daysRemaining <= DUE_SOON_DAYS)

  const status = overdue ? 'overdue' : dueSoon ? 'due_soon' : 'ok'
  return { hoursRemaining, daysRemaining, dueDate, status }
}
