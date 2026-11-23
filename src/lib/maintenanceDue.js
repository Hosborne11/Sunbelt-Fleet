// Keep in step with public.pm_status (supabase/migrations/007_pm_plans.sql)
export const DUE_SOON_HOURS = 75
const DUE_SOON_DAYS = 14

// Returns { hoursRemaining, dueAtHours, dueDate, daysRemaining, status } where status is
// 'overdue' | 'due_soon' | 'ok' | 'unknown' (not enough data to compute).
export function computeDue(plan, assetHourMeter) {
  let hoursRemaining = null
  let daysRemaining = null
  let dueDate = null

  // next_due_hours is maintained by the database (last service + interval, or the next
  // interval mark when no service has been recorded yet)
  const dueAtHours =
    plan.next_due_hours ??
    (plan.interval_hours != null && plan.last_service_hours != null
      ? Number(plan.last_service_hours) + Number(plan.interval_hours)
      : null)

  if (dueAtHours != null && assetHourMeter != null) {
    hoursRemaining = Number(dueAtHours) - Number(assetHourMeter)
  }

  if (plan.interval_days != null && plan.last_service_date) {
    const d = new Date(plan.last_service_date)
    d.setDate(d.getDate() + plan.interval_days)
    dueDate = d.toISOString().slice(0, 10)
    daysRemaining = Math.round((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  }

  if (hoursRemaining == null && daysRemaining == null) {
    return { hoursRemaining, dueAtHours, daysRemaining, dueDate, status: 'unknown' }
  }

  const overdue =
    (hoursRemaining != null && hoursRemaining <= 0) || (daysRemaining != null && daysRemaining <= 0)
  const dueSoon =
    (hoursRemaining != null && hoursRemaining <= DUE_SOON_HOURS) ||
    (daysRemaining != null && daysRemaining <= DUE_SOON_DAYS)

  const status = overdue ? 'overdue' : dueSoon ? 'due_soon' : 'ok'
  return { hoursRemaining, dueAtHours, daysRemaining, dueDate, status }
}

// A PM is flagged for scheduling when it's due soon or overdue and has no scheduled date
export function needsScheduling(plan, due) {
  return (due.status === 'due_soon' || due.status === 'overdue') && !plan.scheduled_for
}

export function fmtDate(d) {
  if (!d) return ''
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
