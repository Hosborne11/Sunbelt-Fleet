import { supabase } from './supabase'

// Each report defines: id, category, name, description, optional filters,
// and a fetch(filters) function returning { columns, rows } or
// { columns, groups: [{ label, rows }] } for grouped reports.
// columns: [{ key, label }] — key indexes into each row object.

function today() {
  return new Date().toISOString().slice(0, 10)
}

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function daysFromNow(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function groupBy(rows, keyFn) {
  const map = new Map()
  for (const row of rows) {
    const key = keyFn(row) || 'Unassigned'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(row)
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, rows]) => ({ label, rows }))
}

// ---------- Fleet Inventory ----------

async function fetchAssetsWithRelations() {
  const { data, error } = await supabase
    .from('assets')
    .select(
      '*, category:equipment_categories(name), jobsite:jobsites(name)'
    )
    .order('asset_number')
  if (error) throw error
  return (data || []).map((a) => ({
    ...a,
    category_name: a.category?.name || 'Uncategorized',
    jobsite_name: a.jobsite?.name || 'Unassigned / yard',
  }))
}

const ASSET_COLUMNS = [
  { key: 'asset_number', label: 'Asset #' },
  { key: 'category_name', label: 'Category' },
  { key: 'make', label: 'Make' },
  { key: 'model', label: 'Model' },
  { key: 'serial_number', label: 'Serial #' },
  { key: 'jobsite_name', label: 'Jobsite' },
  { key: 'status', label: 'Status' },
  { key: 'hour_meter', label: 'Hours' },
]

// ---------- Work Orders ----------

async function fetchWorkOrdersWithRelations() {
  const { data, error } = await supabase
    .from('work_orders')
    .select('*, asset:assets(asset_number, jobsite:jobsites(name))')
    .order('due_date', { ascending: true, nullsFirst: false })
  if (error) throw error
  return (data || []).map((w) => ({
    ...w,
    asset_number: w.asset?.asset_number || 'Unassigned',
    jobsite_name: w.asset?.jobsite?.name || 'Unassigned / yard',
  }))
}

const WORK_ORDER_COLUMNS = [
  { key: 'title', label: 'Title' },
  { key: 'asset_number', label: 'Asset' },
  { key: 'type', label: 'Type' },
  { key: 'priority', label: 'Priority' },
  { key: 'status', label: 'Status' },
  { key: 'due_date', label: 'Due' },
  { key: 'assigned_to', label: 'Assigned to' },
]

const CLOSED_WORK_ORDER_COLUMNS = [
  { key: 'title', label: 'Title' },
  { key: 'asset_number', label: 'Asset' },
  { key: 'type', label: 'Type' },
  { key: 'assigned_to', label: 'Assigned to' },
  { key: 'closed_at', label: 'Closed' },
]

// ---------- Rentals & Leases ----------

async function fetchRentalsWithRelations() {
  const { data, error } = await supabase
    .from('rentals')
    .select('*, asset:assets(asset_number)')
    .order('start_date', { ascending: false })
  if (error) throw error
  return (data || []).map((r) => ({ ...r, asset_number: r.asset?.asset_number || '—' }))
}

async function fetchLeasesWithRelations() {
  const { data, error } = await supabase
    .from('leases')
    .select('*, asset:assets(asset_number)')
    .order('start_date', { ascending: false })
  if (error) throw error
  return (data || []).map((l) => ({ ...l, asset_number: l.asset?.asset_number || '—' }))
}

const RENTAL_COLUMNS = [
  { key: 'renter', label: 'Renter' },
  { key: 'asset_number', label: 'Asset' },
  { key: 'rate', label: 'Rate' },
  { key: 'rate_period', label: 'Period' },
  { key: 'start_date', label: 'Start' },
  { key: 'end_date', label: 'End' },
  { key: 'status', label: 'Status' },
]

const LEASE_COLUMNS = [
  { key: 'lessee', label: 'Lessee' },
  { key: 'asset_number', label: 'Asset' },
  { key: 'monthly_rate', label: 'Monthly rate' },
  { key: 'start_date', label: 'Start' },
  { key: 'end_date', label: 'End' },
  { key: 'status', label: 'Status' },
]

// ---------- Inspections ----------

async function fetchInspectionsWithRelations() {
  const { data, error } = await supabase
    .from('inspections')
    .select('*, asset:assets(asset_number)')
    .order('inspected_at', { ascending: false })
  if (error) throw error
  return (data || []).map((i) => ({ ...i, asset_number: i.asset?.asset_number || '—' }))
}

const INSPECTION_COLUMNS = [
  { key: 'asset_number', label: 'Asset' },
  { key: 'inspection_type', label: 'Type' },
  { key: 'result', label: 'Result' },
  { key: 'inspector', label: 'Inspector' },
  { key: 'inspected_at', label: 'Date' },
]

// ---------- Report registry ----------

export const REPORTS = [
  {
    id: 'fleet-inventory-all',
    category: 'Fleet Inventory',
    name: 'Fleet Inventory (All Assets)',
    description: 'Every asset in the registry, one row per machine.',
    columns: ASSET_COLUMNS,
    async fetch() {
      const rows = await fetchAssetsWithRelations()
      return { columns: ASSET_COLUMNS, rows }
    },
  },
  {
    id: 'fleet-inventory-by-jobsite',
    category: 'Fleet Inventory',
    name: 'Fleet Inventory By Jobsite',
    description: 'Assets grouped by the jobsite they are assigned to.',
    columns: ASSET_COLUMNS,
    async fetch() {
      const rows = await fetchAssetsWithRelations()
      return { columns: ASSET_COLUMNS, groups: groupBy(rows, (r) => r.jobsite_name) }
    },
  },
  {
    id: 'fleet-inventory-by-category',
    category: 'Fleet Inventory',
    name: 'Fleet Inventory By Category',
    description: 'Assets grouped by equipment category.',
    columns: ASSET_COLUMNS,
    async fetch() {
      const rows = await fetchAssetsWithRelations()
      return { columns: ASSET_COLUMNS, groups: groupBy(rows, (r) => r.category_name) }
    },
  },
  {
    id: 'open-work-orders',
    category: 'Work Orders',
    name: 'Open Work Order Report',
    description: 'All work orders not yet closed.',
    columns: WORK_ORDER_COLUMNS,
    async fetch() {
      const rows = (await fetchWorkOrdersWithRelations()).filter((w) => w.status !== 'closed')
      return { columns: WORK_ORDER_COLUMNS, rows }
    },
  },
  {
    id: 'open-work-orders-by-assigned',
    category: 'Work Orders',
    name: 'Open Work Order Log By Assigned To',
    description: 'Open work orders grouped by who they are assigned to.',
    columns: WORK_ORDER_COLUMNS,
    async fetch() {
      const rows = (await fetchWorkOrdersWithRelations()).filter((w) => w.status !== 'closed')
      return { columns: WORK_ORDER_COLUMNS, groups: groupBy(rows, (r) => r.assigned_to || 'Unassigned') }
    },
  },
  {
    id: 'open-work-orders-by-jobsite',
    category: 'Work Orders',
    name: 'Open Work Order Log By Jobsite',
    description: 'Open work orders grouped by the jobsite of their asset.',
    columns: WORK_ORDER_COLUMNS,
    async fetch() {
      const rows = (await fetchWorkOrdersWithRelations()).filter((w) => w.status !== 'closed')
      return { columns: WORK_ORDER_COLUMNS, groups: groupBy(rows, (r) => r.jobsite_name) }
    },
  },
  {
    id: 'closed-work-order-log',
    category: 'Work Orders',
    name: 'Work Order Closed Log',
    description: 'Work orders closed in the last N days.',
    columns: CLOSED_WORK_ORDER_COLUMNS,
    filters: [{ key: 'days', label: 'Days back', type: 'number', default: 21 }],
    async fetch(filters) {
      const cutoff = daysAgo(filters.days ?? 21)
      const rows = (await fetchWorkOrdersWithRelations()).filter(
        (w) => w.status === 'closed' && w.closed_at && w.closed_at.slice(0, 10) >= cutoff
      )
      return { columns: CLOSED_WORK_ORDER_COLUMNS, rows }
    },
  },
  {
    id: 'closed-work-order-by-machine',
    category: 'Work Orders',
    name: 'Work Order Closed Log By Machine',
    description: 'Closed work orders grouped by asset.',
    columns: CLOSED_WORK_ORDER_COLUMNS,
    async fetch() {
      const rows = (await fetchWorkOrdersWithRelations()).filter((w) => w.status === 'closed')
      return { columns: CLOSED_WORK_ORDER_COLUMNS, groups: groupBy(rows, (r) => r.asset_number) }
    },
  },
  {
    id: 'active-rentals',
    category: 'Rentals & Leases',
    name: 'Active Rentals',
    description: 'Rentals currently active, with rate and asset.',
    columns: RENTAL_COLUMNS,
    async fetch() {
      const rows = (await fetchRentalsWithRelations()).filter((r) => r.status === 'active')
      return { columns: RENTAL_COLUMNS, rows }
    },
  },
  {
    id: 'rental-fleet-spend',
    category: 'Rentals & Leases',
    name: 'Rental Fleet (All Records)',
    description: 'Every rental on file, active and returned, with rate detail.',
    columns: RENTAL_COLUMNS,
    async fetch() {
      const rows = await fetchRentalsWithRelations()
      return { columns: RENTAL_COLUMNS, rows }
    },
  },
  {
    id: 'active-leases',
    category: 'Rentals & Leases',
    name: 'Active Leases',
    description: 'Leases currently active, with monthly rate and asset.',
    columns: LEASE_COLUMNS,
    async fetch() {
      const rows = (await fetchLeasesWithRelations()).filter((l) => l.status === 'active')
      return { columns: LEASE_COLUMNS, rows }
    },
  },
  {
    id: 'leases-expiring',
    category: 'Rentals & Leases',
    name: 'Leases Expiring Soon',
    description: 'Active leases ending within N days.',
    columns: LEASE_COLUMNS,
    filters: [{ key: 'days', label: 'Within days', type: 'number', default: 30 }],
    async fetch(filters) {
      const cutoff = daysFromNow(filters.days ?? 30)
      const now = today()
      const rows = (await fetchLeasesWithRelations()).filter(
        (l) => l.status === 'active' && l.end_date && l.end_date >= now && l.end_date <= cutoff
      )
      return { columns: LEASE_COLUMNS, rows }
    },
  },
  {
    id: 'inspections-today',
    category: 'Miscellaneous',
    name: 'Daily Inspections Completed',
    description: "Inspections logged today.",
    columns: INSPECTION_COLUMNS,
    async fetch() {
      const now = today()
      const rows = (await fetchInspectionsWithRelations()).filter((i) => i.inspected_at === now)
      return { columns: INSPECTION_COLUMNS, rows }
    },
  },
  {
    id: 'inspections-failed',
    category: 'Miscellaneous',
    name: 'Failed / Needs Attention Inspections',
    description: 'All inspections that did not pass.',
    columns: INSPECTION_COLUMNS,
    async fetch() {
      const rows = (await fetchInspectionsWithRelations()).filter((i) => i.result !== 'pass')
      return { columns: INSPECTION_COLUMNS, rows }
    },
  },
]

export function reportsByCategory() {
  const cats = new Map()
  for (const r of REPORTS) {
    if (!cats.has(r.category)) cats.set(r.category, [])
    cats.get(r.category).push(r)
  }
  return Array.from(cats.entries())
}

export function toCSV(columns, rows) {
  const escape = (v) => {
    if (v == null) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = columns.map((c) => escape(c.label)).join(',')
  const lines = rows.map((row) => columns.map((c) => escape(row[c.key])).join(','))
  return [header, ...lines].join('\n')
}

export function downloadCSV(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
