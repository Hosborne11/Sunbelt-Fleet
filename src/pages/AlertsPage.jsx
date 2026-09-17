import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, AlertTriangle, AlertCircle, CheckCircle2, BellOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import AlertDrawer from '../components/AlertDrawer'

const TABS = ['Open', 'All', 'Resolved']

const SEVERITY_STYLES = {
  low: 'bg-graphite-600/40 text-ink-500 border-graphite-500/40',
  medium: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  high: 'bg-rust-500/15 text-rust-400 border-rust-500/30',
}

const STATUS_STYLES = {
  open: 'bg-rust-500/15 text-rust-400 border-rust-500/30',
  acknowledged: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  resolved: 'bg-graphite-600/40 text-ink-500 border-graphite-500/40',
}

function Badge({ text, cls }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {text}
    </span>
  )
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([])
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('Open')
  const [search, setSearch] = useState('')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingAlert, setEditingAlert] = useState(null)

  async function loadAll() {
    setLoading(true)
    setError(null)
    const [alertsRes, assetsRes] = await Promise.all([
      supabase
        .from('alerts')
        .select('*, asset:assets(id,asset_number)')
        .order('created_at', { ascending: false }),
      supabase.from('assets').select('id, asset_number').order('asset_number'),
    ])
    if (alertsRes.error) setError(alertsRes.error.message)
    setAlerts(alertsRes.data || [])
    setAssets(assetsRes.data || [])
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
  }, [])

  const counts = useMemo(() => {
    const open = alerts.filter((a) => a.status !== 'resolved')
    return {
      high: open.filter((a) => a.severity === 'high').length,
      medium: open.filter((a) => a.severity === 'medium').length,
      low: open.filter((a) => a.severity === 'low').length,
    }
  }, [alerts])

  const filtered = useMemo(() => {
    return alerts.filter((a) => {
      if (tab === 'Open' && a.status === 'resolved') return false
      if (tab === 'Resolved' && a.status !== 'resolved') return false
      if (search) {
        const q = search.toLowerCase()
        const hay = [a.message, a.asset?.asset_number].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [alerts, tab, search])

  function openAdd() {
    setEditingAlert(null)
    setDrawerOpen(true)
  }
  function openEdit(a) {
    setEditingAlert(a)
    setDrawerOpen(true)
  }
  function closeDrawer() {
    setDrawerOpen(false)
    setEditingAlert(null)
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
            <h1 className="text-xl font-semibold text-ink-100">Alerts</h1>
            <p className="mt-0.5 text-sm text-ink-500">
              {loading ? 'Loading…' : `${filtered.length} of ${alerts.length} alerts`}
            </p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
          >
            <Plus size={16} /> New alert
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <SummaryCard icon={AlertTriangle} label="High severity" value={counts.high} accent="rust" />
          <SummaryCard icon={AlertCircle} label="Medium severity" value={counts.medium} accent="amber" />
          <SummaryCard icon={BellOff} label="Low severity" value={counts.low} />
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
              placeholder="Search message, asset…"
              className="w-64 rounded border border-graphite-600 bg-graphite-900 py-1.5 pl-8 pr-3 text-sm text-ink-100 placeholder:text-ink-500 outline-none focus:border-amber-400/60"
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-4">
        {error && (
          <div className="mb-4 rounded border border-rust-500/30 bg-rust-500/10 px-4 py-3 text-sm text-rust-400">
            {error.includes('relation') || error.includes('does not exist')
              ? "Couldn't find the alerts table yet — run supabase/migrations/004_alerts.sql in your Supabase project's SQL editor, then reload."
              : error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded border border-dashed border-graphite-600 py-16 text-center">
            <CheckCircle2 size={28} className="mb-2 text-ink-500" />
            <p className="text-ink-300">
              {alerts.length === 0 ? 'No alerts yet — nothing flagged.' : 'No alerts match this view.'}
            </p>
            {alerts.length === 0 && (
              <button
                onClick={openAdd}
                className="mt-3 rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
              >
                Log an alert
              </button>
            )}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="overflow-x-auto rounded border border-graphite-800">
            <table className="w-full min-w-[720px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-72" />
                <col className="w-32" />
                <col className="w-32" />
                <col className="w-32" />
                <col className="w-36" />
              </colgroup>
              <thead>
                <tr className="border-b border-graphite-700 bg-graphite-800/60 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="py-2 pl-3 pr-3 font-medium">Message</th>
                  <th className="py-2 pr-3 font-medium">Asset</th>
                  <th className="py-2 pr-3 font-medium">Severity</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Logged</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => openEdit(a)}
                    className="cursor-pointer border-b border-graphite-800 hover:bg-graphite-800/60"
                  >
                    <td className="truncate py-2.5 pl-3 pr-3 text-ink-100" title={a.message}>
                      {a.message}
                    </td>
                    <td className="truncate py-2.5 pr-3 font-mono text-ink-300">
                      {a.asset_id ? (
                        <Link
                          to={`/assets/${a.asset_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-amber-400 hover:underline"
                        >
                          {a.asset?.asset_number || '—'}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge text={a.severity} cls={SEVERITY_STYLES[a.severity]} />
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge text={a.status} cls={STATUS_STYLES[a.status]} />
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-ink-500">
                      {new Date(a.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawerOpen && (
        <AlertDrawer
          alert={editingAlert}
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
