import { supabase } from './supabase'

// Reporting status from fleet.v_fleet_today -> label + colors (matches the app's palette)
export const REPORTING = {
  live: { label: 'Live', dot: 'bg-teal-400', text: 'text-teal-400', hex: '#3FA796' },
  recent: { label: 'Today', dot: 'bg-teal-500', text: 'text-teal-400', hex: '#2E8B7C' },
  stale: { label: 'Stale', dot: 'bg-amber-400', text: 'text-amber-400', hex: '#F2A93B' },
  offline: { label: 'Offline', dot: 'bg-rust-400', text: 'text-rust-400', hex: '#E5644B' },
  no_data: { label: 'No data', dot: 'bg-graphite-500', text: 'text-ink-500', hex: '#4A5158' },
}

export function reportingMeta(status) {
  return REPORTING[status] || REPORTING.no_data
}

// All linked machines' current telematics, keyed by registry asset id
export async function fetchTelematicsByAsset() {
  const { data, error } = await supabase.from('asset_telematics').select('*')
  if (error) return { map: {}, error: error.message }
  const map = {}
  for (const row of data || []) map[row.asset_id] = row
  return { map, error: null }
}

export function timeAgo(iso) {
  if (!iso) return '—'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`
  const days = Math.round(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function fmtHours(v, digits = 1) {
  return v == null ? '—' : `${Number(v).toFixed(digits)} hrs`
}

export function fmtPct(v) {
  return v == null ? '—' : `${Math.round(Number(v))}%`
}
