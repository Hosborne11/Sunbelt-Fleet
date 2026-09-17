import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, Wrench, Hammer, AlertTriangle, ClipboardList } from 'lucide-react'
import { supabase } from '../lib/supabase'
import WorkOrderDrawer from '../components/WorkOrderDrawer'

const TABS = ['Active', 'All', 'Closed']

const PRIORITY_STYLES = {
  low: 'bg-graphite-600/40 text-ink-500 border-graphite-500/40',
  normal: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  high: 'bg-rust-500/15 text-rust-400 border-rust-500/30',
}

const STATUS_STYLES = {
  open: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  in_progress: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  closed: 'bg-graphite-600/40 text-ink-500 border-graphite-500/40',
}

function Badge({ text, cls }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {text}
    </span>
  )
}

export default function WorkOrdersPage() {
  const [workOrders, setWorkOrders] = useState([])
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('Active')
  const [search, setSearch] = useState('')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingWO, setEditingWO] = useState(null)

  async function loadAll() {
    setLoading(true)
    setError(null)
    const [woRes, assetsRes] = await Promise.all([
      supabase
        .from('work_orders')
        .select('*, asset:assets(id,asset_number)')
        .order('due_date', { ascending: true, nullsFirst: false }),
      supabase.from('assets').select('id, asset_number').order('asset_number'),
    ])
    if (woRes.error) setError(woRes.error.message)
    setWorkOrders(woRes.data || [])
    setAssets(assetsRes.data || [])
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
  }, [])

  const today = new Date().toISOString().slice(0, 10)

  const counts = useMemo(() => {
    const open = workOrders.filter((w) => w.status !== 'closed')
    return {
      maintenance: open.filter((w) => w.type === 'maintenance').length,
      repairs: open.filter((w) => w.type === 'repair').length,
      overdue: open.filter((w) => w.due_date && w.due_date < today).length,
      total: workOrders.length,
    }
  }, [workOrders, today])

  const filtered = useMemo(() => {
    return workOrders.filter((w) => {
      if (tab === 'Active' && w.status === 'closed') return false
      if (tab === 'Closed' && w.status !== 'closed') return false
      if (search) {
        const q = search.toLowerCase()
        const hay = [w.title, w.asset?.asset_number, w.assigned_to].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [workOrders, tab, search])

  function openAdd() {
    setEditingWO(null)
    setDrawerOpen(true)
  }
  function openEdit(wo) {
    setEditingWO(wo)
    setDrawerOpen(true)
  }
  function closeDrawer() {
    setDrawerOpen(false)
    setEditingWO(null)
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
            <h1 className="text-xl font-semibold text-ink-100">Work Orders</h1>
            <p className="mt-0.5 text-sm text-ink-500">
              {loading ? 'Loading…' : `${filtered.length} of ${workOrders.length} work orders`}
            </p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
          >
            <Plus size={16} /> New work order
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-3">
          <SummaryCard icon={Wrench} label="Maintenance" value={counts.maintenance} />
          <SummaryCard icon={Hammer} label="Repairs" value={counts.repairs} />
          <SummaryCard icon={AlertTriangle} label="Overdue" value={counts.overdue} accent="rust" />
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
              placeholder="Search title, asset, assignee…"
              className="w-64 rounded border border-graphite-600 bg-graphite-900 py-1.5 pl-8 pr-3 text-sm text-ink-100 placeholder:text-ink-500 outline-none focus:border-amber-400/60"
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-4">
        {error && (
          <div className="mb-4 rounded border border-rust-500/30 bg-rust-500/10 px-4 py-3 text-sm text-rust-400">
            {error.includes('relation') || error.includes('does not exist')
              ? "Couldn't find the work_orders table yet — run supabase/migrations/003_work_orders.sql in your Supabase project's SQL editor, then reload."
              : error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded border border-dashed border-graphite-600 py-16 text-center">
            <ClipboardList size={28} className="mb-2 text-ink-500" />
            <p className="text-ink-300">
              {workOrders.length === 0 ? 'No work orders yet.' : 'No work orders match this view.'}
            </p>
            {workOrders.length === 0 && (
              <button
                onClick={openAdd}
                className="mt-3 rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
              >
                Create your first work order
              </button>
            )}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="overflow-x-auto rounded border border-graphite-800">
            <table className="w-full min-w-[820px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-64" />
                <col className="w-28" />
                <col className="w-24" />
                <col className="w-32" />
                <col className="w-32" />
                <col className="w-28" />
                <col className="w-28" />
              </colgroup>
              <thead>
                <tr className="border-b border-graphite-700 bg-graphite-800/60 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="py-2 pl-3 pr-3 font-medium">Title</th>
                  <th className="py-2 pr-3 font-medium">Asset</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">Priority</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Due</th>
                  <th className="py-2 pr-3 font-medium">Assigned</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((w) => {
                  const overdue = w.due_date && w.due_date < today && w.status !== 'closed'
                  return (
                    <tr
                      key={w.id}
                      onClick={() => openEdit(w)}
                      className="cursor-pointer border-b border-graphite-800 hover:bg-graphite-800/60"
                    >
                      <td className="truncate py-2.5 pl-3 pr-3 text-ink-100" title={w.title}>
                        {w.title}
                      </td>
                      <td className="truncate py-2.5 pr-3 font-mono text-ink-300">
                        {w.asset_id ? (
                          <Link
                            to={`/assets/${w.asset_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:text-amber-400 hover:underline"
                          >
                            {w.asset?.asset_number || '—'}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2.5 pr-3 capitalize text-ink-300">{w.type}</td>
                      <td className="py-2.5 pr-3">
                        <Badge text={w.priority} cls={PRIORITY_STYLES[w.priority]} />
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge text={w.status.replace('_', ' ')} cls={STATUS_STYLES[w.status]} />
                      </td>
                      <td className={`py-2.5 pr-3 font-mono ${overdue ? 'text-rust-400' : 'text-ink-500'}`}>
                        {w.due_date || '—'}
                      </td>
                      <td className="truncate py-2.5 pr-3 text-ink-300">{w.assigned_to || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawerOpen && (
        <WorkOrderDrawer
          workOrder={editingWO}
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
  const accentCls = accent === 'rust' && value > 0 ? 'text-rust-400' : 'text-ink-100'
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
