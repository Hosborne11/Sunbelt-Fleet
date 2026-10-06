import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, Wrench, AlertTriangle, Clock, CalendarX } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { computeDue, needsScheduling, fmtDate, DUE_SOON_HOURS } from '../lib/maintenanceDue'
import MaintenancePlanDrawer from '../components/MaintenancePlanDrawer'
import { REQUEST_STATUS } from '../lib/pm'

const TABS = ['All', 'Overdue', 'Due Soon', 'Not scheduled']

const STATUS_STYLES = {
  overdue: 'bg-rust-500/15 text-rust-400 border-rust-500/30',
  due_soon: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  ok: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  unknown: 'bg-graphite-600/40 text-ink-500 border-graphite-500/40',
}

const STATUS_LABELS = {
  overdue: 'Overdue',
  due_soon: 'Due soon',
  ok: 'OK',
  unknown: 'No data',
}

function Badge({ status }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {STATUS_LABELS[status]}
    </span>
  )
}

export default function MaintenancePlansPage() {
  const [plans, setPlans] = useState([])
  const [assets, setAssets] = useState([])
  const [requests, setRequests] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('All')
  const [search, setSearch] = useState('')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState(null)

  async function loadAll() {
    setLoading(true)
    setError(null)
    const [plansRes, assetsRes, reqRes] = await Promise.all([
      supabase
        .from('maintenance_plans')
        .select('*, asset:assets(id,asset_number,hour_meter)')
        .order('name'),
      supabase.from('assets').select('id, asset_number').order('asset_number'),
      supabase.from('pm_requests').select('plan_id, status, scheduled_date, vendor_name')
        .in('status', ['requested', 'scheduled', 'awaiting_confirmation']),
    ])
    setRequests(Object.fromEntries((reqRes.data || []).map((r) => [r.plan_id, r])))
    if (plansRes.error) setError(plansRes.error.message)
    setPlans(plansRes.data || [])
    setAssets(assetsRes.data || [])
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
  }, [])

  const enriched = useMemo(() => {
    return plans.map((p) => ({ ...p, due: computeDue(p, p.asset?.hour_meter) }))
  }, [plans])

  const filtered = useMemo(() => {
    return enriched.filter((p) => {
      if (tab === 'Overdue' && p.due.status !== 'overdue') return false
      if (tab === 'Due Soon' && p.due.status !== 'due_soon') return false
      if (tab === 'Not scheduled' && (!needsScheduling(p, p.due) || requests[p.id])) return false
      if (search) {
        const q = search.toLowerCase()
        const hay = [p.name, p.asset?.asset_number].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [enriched, tab, search, requests])

  const counts = useMemo(
    () => ({
      overdue: enriched.filter((p) => p.due.status === 'overdue').length,
      dueSoon: enriched.filter((p) => p.due.status === 'due_soon').length,
      unscheduled: enriched.filter((p) => needsScheduling(p, p.due)).length,
    }),
    [enriched]
  )

  function openAdd() {
    setEditingPlan(null)
    setDrawerOpen(true)
  }
  function openEdit(p) {
    setEditingPlan(p)
    setDrawerOpen(true)
  }
  function closeDrawer() {
    setDrawerOpen(false)
    setEditingPlan(null)
  }
  function onSaved() {
    closeDrawer()
    loadAll()
  }
  function onDeleted() {
    closeDrawer()
    loadAll()
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-graphite-700 px-6 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-ink-100">Maintenance Plans</h1>
            <p className="mt-0.5 text-sm text-ink-500">
              {loading ? 'Loading…' : `${filtered.length} of ${plans.length} plans`}
            </p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
          >
            <Plus size={16} /> New plan
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard icon={AlertTriangle} label="Overdue" value={counts.overdue} accent="rust" />
          <SummaryCard icon={Clock} label={`Due within ${DUE_SOON_HOURS} hrs`} value={counts.dueSoon} accent="amber" />
          <SummaryCard icon={CalendarX} label="Due, not scheduled" value={counts.unscheduled} accent="amber" />
          <SummaryCard icon={Wrench} label="Total plans" value={plans.length} />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-1 rounded border border-graphite-700 bg-graphite-900 p-1 w-fit">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded px-3 py-1.5 text-sm transition-colors ${
                  tab === t
                    ? 'bg-amber-400 text-graphite-950 font-medium'
                    : 'text-ink-300 hover:text-ink-100'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search plan, asset…"
              className="w-64 rounded border border-graphite-600 bg-graphite-900 py-1.5 pl-8 pr-3 text-sm text-ink-100 placeholder:text-ink-500 outline-none focus:border-amber-400/60"
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-4">
        {error && (
          <div className="mb-4 rounded border border-rust-500/30 bg-rust-500/10 px-4 py-3 text-sm text-rust-400">
            {error.includes('relation') || error.includes('does not exist')
              ? "Maintenance tables are missing. Run supabase/migrations/003_app_tables.sql and 007_pm_plans.sql in the Supabase SQL editor, then reload."
              : error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded border border-dashed border-graphite-600 py-16 text-center">
            <Wrench size={28} className="mb-2 text-ink-500" />
            <p className="text-ink-300">
              {plans.length === 0 ? 'No maintenance plans yet.' : 'No plans match this view.'}
            </p>
            {plans.length === 0 && (
              <button
                onClick={openAdd}
                className="mt-3 rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
              >
                Create your first plan
              </button>
            )}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="overflow-x-auto rounded border border-graphite-800">
            <table className="w-full min-w-[980px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-48" />
                <col className="w-28" />
                <col className="w-24" />
                <col className="w-36" />
                <col className="w-24" />
                <col className="w-24" />
                <col className="w-32" />
                <col className="w-28" />
              </colgroup>
              <thead>
                <tr className="border-b border-graphite-700 bg-graphite-800/60 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="py-2 pl-3 pr-3 font-medium">Plan</th>
                  <th className="py-2 pr-3 font-medium">Asset</th>
                  <th className="py-2 pr-3 font-medium">Interval</th>
                  <th className="py-2 pr-3 font-medium">Last service</th>
                  <th className="py-2 pr-3 font-medium">Due at</th>
                  <th className="py-2 pr-3 font-medium">Hours left</th>
                  <th className="py-2 pr-3 font-medium">Scheduled</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => openEdit(p)}
                    className="cursor-pointer border-b border-graphite-800 hover:bg-graphite-800/60"
                  >
                    <td className="truncate py-2.5 pl-3 pr-3 text-ink-100">{p.name}</td>
                    <td className="truncate py-2.5 pr-3 font-mono text-ink-300">
                      {p.asset?.asset_number || '—'}
                    </td>
                    <td className="py-2.5 pr-3 text-ink-500">
                      {[p.interval_hours ? `${p.interval_hours} hrs` : null, p.interval_days ? `${p.interval_days} days` : null]
                        .filter(Boolean)
                        .join(' / ') || '—'}
                    </td>
                    <td className="truncate py-2.5 pr-3 text-ink-500">
                      {p.last_service_hours != null || p.last_service_date
                        ? [p.last_service_date && fmtDate(p.last_service_date),
                           p.last_service_hours != null && `${Math.round(p.last_service_hours).toLocaleString()} hrs`]
                            .filter(Boolean).join(', ')
                        : <span className="italic">Not recorded</span>}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-ink-500">
                      {p.due.dueAtHours != null ? Math.round(p.due.dueAtHours).toLocaleString() : p.due.dueDate || '—'}
                    </td>
                    <td className={`py-2.5 pr-3 font-mono ${p.due.status === 'overdue' ? 'text-rust-400' : p.due.status === 'due_soon' ? 'text-amber-400' : 'text-ink-500'}`}>
                      {p.due.hoursRemaining == null
                        ? '—'
                        : p.due.hoursRemaining < 0
                          ? `${Math.abs(Math.round(p.due.hoursRemaining))} over`
                          : Math.round(p.due.hoursRemaining)}
                    </td>
                    <td className="truncate py-2.5 pr-3">
                      {requests[p.id] && requests[p.id].status !== 'scheduled' ? (
                        <span className="rounded border border-amber-400/50 px-1.5 py-0.5 text-[11px] text-amber-400"
                              title={REQUEST_STATUS[requests[p.id].status].hint}>
                          {requests[p.id].status === 'requested' ? `Requested from ${requests[p.id].vendor_name || 'vendor'}` : 'Waiting on confirmation'}
                        </span>
                      ) : p.scheduled_for ? (
                        <span className="text-teal-400" title={p.scheduled_note || ''}>
                          {fmtDate(p.scheduled_for)}{p.scheduled_note ? `, ${p.scheduled_note}` : ''}
                        </span>
                      ) : needsScheduling(p, p.due) ? (
                        <span className="rounded bg-amber-400 px-1.5 py-0.5 text-[11px] font-medium text-graphite-950">Needs a date</span>
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge status={p.due.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawerOpen && (
        <MaintenancePlanDrawer
          plan={editingPlan}
          assets={assets}
          onClose={closeDrawer}
          onSaved={onSaved}
          onDeleted={onDeleted}
        />
      )}
    </div>
  )
}

function SummaryCard({ icon: Icon, label, value, accent }) {
  const accentCls =
    (accent === 'rust' && value > 0 && 'text-rust-400') ||
    (accent === 'amber' && value > 0 && 'text-amber-400') ||
    'text-ink-100'
  return (
    <div className="flex items-center gap-3 rounded border border-graphite-700 bg-graphite-800 px-4 py-3">
      <Icon size={18} strokeWidth={1.75} className="text-ink-500" />
      <div>
        <div className={`text-lg font-semibold ${accentCls}`}>{value}</div>
        <div className="text-xs text-ink-500">{label}</div>
      </div>
    </div>
  )
}
