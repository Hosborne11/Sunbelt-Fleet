import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Truck,
  MapPin,
  AlertOctagon,
  Bell,
  Wrench,
  CalendarClock,
  FileSignature,
  AlertTriangle,
  ClipboardCheck,
  Clock,
  DollarSign,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { iconFor } from '../lib/categoryIcons'
import { bookValue, formatCurrency } from '../lib/depreciation'
import { computeDue } from '../lib/maintenanceDue'

function Kpi({ icon: Icon, label, value, to, tone }) {
  const toneCls =
    (tone === 'rust' && value > 0 && 'text-rust-400') ||
    (tone === 'amber' && value > 0 && 'text-amber-400') ||
    'text-ink-100'
  const content = (
    <div className="flex items-center gap-3 rounded border border-graphite-700 bg-graphite-800 px-4 py-4 transition-colors hover:border-graphite-600">
      <div className="flex h-9 w-9 items-center justify-center rounded bg-graphite-700 text-ink-500">
        <Icon size={18} strokeWidth={1.75} />
      </div>
      <div>
        <div className={`text-2xl font-semibold ${toneCls}`}>{value}</div>
        <div className="text-xs text-ink-500">{label}</div>
      </div>
    </div>
  )
  return to ? <Link to={to}>{content}</Link> : content
}

function Bar({ label, count, total, color, icon: Icon }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-ink-300">
          {Icon && <Icon size={14} strokeWidth={1.75} className="text-ink-500" />}
          {label}
        </span>
        <span className="font-mono text-ink-500">{count}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-graphite-700">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function AttentionPanel({ icon: Icon, title, items, tone, emptyText }) {
  const toneCls = tone === 'rust' ? 'text-rust-400' : 'text-amber-400'
  return (
    <div className="rounded border border-graphite-700 bg-graphite-800/40">
      <div className="flex items-center gap-2 border-b border-graphite-700 px-4 py-2.5 text-sm font-semibold text-ink-100">
        <Icon size={15} strokeWidth={1.75} className={items.length > 0 ? toneCls : 'text-ink-500'} />
        {title}
        <span className="font-normal text-ink-500">({items.length})</span>
      </div>
      <div className="max-h-52 overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-500">{emptyText}</p>
        ) : (
          items.map((item) => (
            <Link
              key={item.key}
              to={item.to}
              className="flex items-center justify-between border-b border-graphite-800 px-4 py-2 text-sm last:border-b-0 hover:bg-graphite-800/60"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-ink-100">{item.primary}</div>
                <div className="truncate text-xs text-ink-500">{item.secondary}</div>
              </div>
              <span className={`ml-3 shrink-0 font-mono text-xs ${toneCls}`}>{item.badge}</span>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}

const ACTIVITY_META = {
  work_order: { icon: Wrench, verb: 'Work order' },
  alert: { icon: Bell, verb: 'Alert' },
  inspection: { icon: ClipboardCheck, verb: 'Inspection' },
  rental: { icon: CalendarClock, verb: 'Rental' },
  lease: { icon: FileSignature, verb: 'Lease' },
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [assets, setAssets] = useState([])
  const [jobsiteCount, setJobsiteCount] = useState(0)
  const [workOrders, setWorkOrders] = useState([])
  const [alerts, setAlerts] = useState([])
  const [inspections, setInspections] = useState([])
  const [rentals, setRentals] = useState([])
  const [leases, setLeases] = useState([])
  const [plans, setPlans] = useState([])
  const [downtimeEvents, setDowntimeEvents] = useState([])

  useEffect(() => {
    async function load() {
      const [assetsRes, jobsitesRes, woRes, alertsRes, inspRes, rentalsRes, leasesRes, plansRes, downtimeRes] =
        await Promise.all([
          supabase
            .from('assets')
            .select('*, category:equipment_categories(name,icon), jobsite:jobsites(name)'),
          supabase.from('jobsites').select('id', { count: 'exact', head: true }),
          supabase.from('work_orders').select('*, asset:assets(id,asset_number)'),
          supabase.from('alerts').select('*, asset:assets(id,asset_number)'),
          supabase.from('inspections').select('*, asset:assets(id,asset_number)'),
          supabase.from('rentals').select('*, asset:assets(id,asset_number)'),
          supabase.from('leases').select('*, asset:assets(id,asset_number)'),
          supabase.from('maintenance_plans').select('*, asset:assets(id,asset_number,hour_meter)'),
          supabase.from('downtime_events').select('*, asset:assets(id,asset_number)').is('ended_at', null),
        ])

      setAssets(assetsRes.data || [])
      setJobsiteCount(jobsitesRes.count ?? 0)
      setWorkOrders(woRes.data || [])
      setAlerts(alertsRes.data || [])
      setInspections(inspRes.data || [])
      setRentals(rentalsRes.data || [])
      setLeases(leasesRes.data || [])
      setPlans(plansRes.data || [])
      setDowntimeEvents(downtimeRes.data || [])
      setLoading(false)
    }
    load()
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const in30Days = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return d.toISOString().slice(0, 10)
  }, [])

  const kpis = useMemo(
    () => ({
      totalMachines: assets.length,
      downMachines: assets.filter((a) => a.status === 'down').length,
      openAlerts: alerts.filter((a) => a.status !== 'resolved').length,
      openWorkOrders: workOrders.filter((w) => w.status !== 'closed').length,
      activeRentals: rentals.filter((r) => r.status === 'active').length,
      activeLeases: leases.filter((l) => l.status === 'active').length,
    }),
    [assets, alerts, workOrders, rentals, leases]
  )

  const byCategory = useMemo(() => {
    const counts = {}
    for (const a of assets) {
      const key = a.category?.name || 'Uncategorized'
      if (!counts[key]) counts[key] = { count: 0, icon: a.category?.icon }
      counts[key].count += 1
    }
    return Object.entries(counts)
      .map(([name, v]) => ({ name, count: v.count, icon: v.icon }))
      .sort((a, b) => b.count - a.count)
  }, [assets])

  const byJobsite = useMemo(() => {
    const counts = {}
    for (const a of assets) {
      const key = a.jobsite?.name || 'Unassigned / yard'
      counts[key] = (counts[key] || 0) + 1
    }
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [assets])

  const byStatus = useMemo(() => {
    const counts = { active: 0, down: 0, maintenance: 0, retired: 0 }
    for (const a of assets) counts[a.status] = (counts[a.status] || 0) + 1
    return counts
  }, [assets])

  const fleetBookValue = useMemo(() => {
    let total = 0
    let countedAssets = 0
    for (const a of assets) {
      const v = bookValue(a)
      if (v) {
        total += v.currentValue
        countedAssets += 1
      }
    }
    return { total, countedAssets }
  }, [assets])

  const upcomingMaintenance = useMemo(
    () =>
      plans
        .map((p) => ({ ...p, due: computeDue(p, p.asset?.hour_meter) }))
        .filter((p) => p.due.status === 'overdue' || p.due.status === 'due_soon')
        .sort((a, b) => (a.due.status === 'overdue' ? -1 : 1))
        .map((p) => ({
          key: p.id,
          to: p.asset_id ? `/assets/${p.asset_id}` : '/maintenance-plans',
          primary: p.name,
          secondary: p.asset?.asset_number || 'Unassigned',
          badge: p.due.status === 'overdue' ? 'overdue' : `${Math.round(p.due.hoursRemaining ?? p.due.daysRemaining)} left`,
        })),
    [plans]
  )

  const downtimeNow = useMemo(
    () =>
      downtimeEvents.map((d) => ({
        key: d.id,
        to: d.asset_id ? `/assets/${d.asset_id}` : '/',
        primary: d.asset?.asset_number || 'Unassigned',
        secondary: `Down since ${new Date(d.started_at).toLocaleDateString()}`,
        badge: `${((Date.now() - new Date(d.started_at).getTime()) / 3600000).toFixed(0)} hrs`,
      })),
    [downtimeEvents]
  )

  const overdueWorkOrders = useMemo(
    () =>
      workOrders
        .filter((w) => w.status !== 'closed' && w.due_date && w.due_date < today)
        .map((w) => ({
          key: w.id,
          to: w.asset_id ? `/assets/${w.asset_id}` : '/work-orders',
          primary: w.title,
          secondary: w.asset?.asset_number || 'Unassigned',
          badge: w.due_date,
        })),
    [workOrders, today]
  )

  const highSeverityAlerts = useMemo(
    () =>
      alerts
        .filter((a) => a.status !== 'resolved' && a.severity === 'high')
        .map((a) => ({
          key: a.id,
          to: a.asset_id ? `/assets/${a.asset_id}` : '/alerts',
          primary: a.message,
          secondary: a.asset?.asset_number || 'Unassigned',
          badge: 'high',
        })),
    [alerts]
  )

  const failedInspections = useMemo(
    () =>
      inspections
        .filter((i) => i.result !== 'pass')
        .slice(0, 10)
        .map((i) => ({
          key: i.id,
          to: i.asset_id ? `/assets/${i.asset_id}` : '/inspections',
          primary: `${i.inspection_type.toUpperCase()} — ${i.result.replace('_', ' ')}`,
          secondary: i.asset?.asset_number || 'Unassigned',
          badge: i.inspected_at,
        })),
    [inspections]
  )

  const expiringLeases = useMemo(
    () =>
      leases
        .filter((l) => l.status === 'active' && l.end_date && l.end_date >= today && l.end_date <= in30Days)
        .map((l) => ({
          key: l.id,
          to: l.asset_id ? `/assets/${l.asset_id}` : '/leases',
          primary: l.lessee,
          secondary: l.asset?.asset_number || 'Unassigned',
          badge: l.end_date,
        })),
    [leases, today, in30Days]
  )

  const overdueRentals = useMemo(
    () =>
      rentals
        .filter((r) => r.status === 'active' && r.end_date && r.end_date < today)
        .map((r) => ({
          key: r.id,
          to: r.asset_id ? `/assets/${r.asset_id}` : '/rentals',
          primary: r.renter,
          secondary: r.asset?.asset_number || 'Unassigned',
          badge: r.end_date,
        })),
    [rentals, today]
  )

  const recentActivity = useMemo(() => {
    const items = [
      ...workOrders.map((w) => ({
        type: 'work_order',
        created_at: w.created_at,
        text: w.title,
        asset: w.asset?.asset_number,
        assetId: w.asset_id,
        to: w.asset_id ? `/assets/${w.asset_id}` : '/work-orders',
      })),
      ...alerts.map((a) => ({
        type: 'alert',
        created_at: a.created_at,
        text: a.message,
        asset: a.asset?.asset_number,
        assetId: a.asset_id,
        to: a.asset_id ? `/assets/${a.asset_id}` : '/alerts',
      })),
      ...inspections.map((i) => ({
        type: 'inspection',
        created_at: i.created_at,
        text: `${i.inspection_type.toUpperCase()} inspection — ${i.result.replace('_', ' ')}`,
        asset: i.asset?.asset_number,
        assetId: i.asset_id,
        to: i.asset_id ? `/assets/${i.asset_id}` : '/inspections',
      })),
      ...rentals.map((r) => ({
        type: 'rental',
        created_at: r.created_at,
        text: `Rental — ${r.renter}`,
        asset: r.asset?.asset_number,
        assetId: r.asset_id,
        to: r.asset_id ? `/assets/${r.asset_id}` : '/rentals',
      })),
      ...leases.map((l) => ({
        type: 'lease',
        created_at: l.created_at,
        text: `Lease — ${l.lessee}`,
        asset: l.asset?.asset_number,
        assetId: l.asset_id,
        to: l.asset_id ? `/assets/${l.asset_id}` : '/leases',
      })),
    ]
    return items
      .filter((i) => i.created_at)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10)
  }, [workOrders, alerts, inspections, rentals, leases])

  if (loading) {
    return <div className="p-6 text-sm text-ink-500">Loading…</div>
  }

  const maxCategory = byCategory[0]?.count || 1
  const maxJobsite = byJobsite[0]?.count || 1

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <h1 className="text-xl font-semibold text-ink-100">Dashboard</h1>
      <p className="mt-0.5 text-sm text-ink-500">
        Fleet-wide status at a glance — click anything to jump straight to it.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <Kpi icon={Truck} label="Total machines" value={kpis.totalMachines} to="/" />
        <Kpi icon={MapPin} label="Jobsites" value={jobsiteCount} to="/jobsites" />
        <Kpi icon={AlertOctagon} label="Down machines" value={kpis.downMachines} to="/" tone="rust" />
        <Kpi icon={Bell} label="Open alerts" value={kpis.openAlerts} to="/alerts" tone="amber" />
        <Kpi
          icon={Wrench}
          label="Open work orders"
          value={kpis.openWorkOrders}
          to="/work-orders"
          tone="amber"
        />
        <Kpi icon={CalendarClock} label="Active rentals" value={kpis.activeRentals} to="/rentals" />
        <Kpi
          icon={DollarSign}
          label="Fleet book value"
          value={fleetBookValue.countedAssets > 0 ? formatCurrency(fleetBookValue.total) : '—'}
          to="/"
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-semibold text-ink-100">Fleet by category</h2>
          <div className="space-y-2.5 rounded border border-graphite-700 bg-graphite-800/40 p-4">
            {byCategory.length === 0 ? (
              <p className="text-sm text-ink-500">No assets yet.</p>
            ) : (
              byCategory.map((c) => (
                <Bar
                  key={c.name}
                  label={c.name}
                  count={c.count}
                  total={maxCategory}
                  color="bg-amber-400"
                  icon={iconFor(c.icon)}
                />
              ))
            )}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-ink-100">Fleet by jobsite</h2>
          <div className="space-y-2.5 rounded border border-graphite-700 bg-graphite-800/40 p-4">
            {byJobsite.length === 0 ? (
              <p className="text-sm text-ink-500">No assets yet.</p>
            ) : (
              byJobsite.map((j) => (
                <Bar key={j.name} label={j.name} count={j.count} total={maxJobsite} color="bg-teal-400" />
              ))
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatusChip label="Active" value={byStatus.active} color="bg-teal-400" />
        <StatusChip label="Down" value={byStatus.down} color="bg-rust-400" />
        <StatusChip label="In service" value={byStatus.maintenance} color="bg-amber-400" />
        <StatusChip label="Retired" value={byStatus.retired} color="bg-graphite-500" />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-ink-100">Needs attention</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <AttentionPanel
          icon={AlertTriangle}
          title="Overdue work orders"
          items={overdueWorkOrders}
          tone="rust"
          emptyText="Nothing overdue."
        />
        <AttentionPanel
          icon={Wrench}
          title="Maintenance due"
          items={upcomingMaintenance}
          tone="amber"
          emptyText="Nothing due soon."
        />
        <AttentionPanel
          icon={AlertOctagon}
          title="Currently down"
          items={downtimeNow}
          tone="rust"
          emptyText="Nothing down right now."
        />
        <AttentionPanel
          icon={Bell}
          title="High-severity alerts"
          items={highSeverityAlerts}
          tone="rust"
          emptyText="No open high-severity alerts."
        />
        <AttentionPanel
          icon={ClipboardCheck}
          title="Failed / flagged inspections"
          items={failedInspections}
          tone="amber"
          emptyText="No failed inspections."
        />
        <AttentionPanel
          icon={FileSignature}
          title="Leases expiring in 30 days"
          items={expiringLeases}
          tone="amber"
          emptyText="Nothing expiring soon."
        />
        <AttentionPanel
          icon={CalendarClock}
          title="Overdue rental returns"
          items={overdueRentals}
          tone="rust"
          emptyText="No overdue returns."
        />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-ink-100">Recent activity</h2>
      <div className="rounded border border-graphite-700 bg-graphite-800/40">
        {recentActivity.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-500">Nothing logged yet.</p>
        ) : (
          recentActivity.map((item, i) => {
            const meta = ACTIVITY_META[item.type]
            const Icon = meta.icon
            return (
              <Link
                key={i}
                to={item.to}
                className="flex items-center gap-3 border-b border-graphite-800 px-4 py-2.5 text-sm last:border-b-0 hover:bg-graphite-800/60"
              >
                <Icon size={15} strokeWidth={1.75} className="shrink-0 text-ink-500" />
                <div className="min-w-0 flex-1">
                  <span className="text-ink-500">{meta.verb}: </span>
                  <span className="text-ink-100">{item.text}</span>
                  {item.asset && <span className="ml-1.5 font-mono text-ink-500">· {item.asset}</span>}
                </div>
                <span className="flex shrink-0 items-center gap-1 text-xs text-ink-500">
                  <Clock size={11} />
                  {new Date(item.created_at).toLocaleDateString()}
                </span>
              </Link>
            )
          })
        )}
      </div>

      <p className="mt-8 rounded border border-dashed border-graphite-600 px-4 py-3 text-sm text-ink-500">
        GoAardvark's dashboard also shows telematics-driven KPIs — machine utilization %, idle
        hours, cost of idle, non-reporting machines — which need a GPS/engine-hour data feed this
        app doesn't have yet.
      </p>
    </div>
  )
}

function StatusChip({ label, value, color }) {
  return (
    <div className="flex items-center gap-2.5 rounded border border-graphite-700 bg-graphite-800 px-4 py-3">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      <div>
        <div className="text-lg font-semibold text-ink-100">{value}</div>
        <div className="text-xs text-ink-500">{label}</div>
      </div>
    </div>
  )
}
