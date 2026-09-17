import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, FileSignature, AlertTriangle, XCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import LeaseDrawer from '../components/LeaseDrawer'

const TABS = ['Active', 'All', 'Ended']

const STATUS_STYLES = {
  active: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  expired: 'bg-graphite-600/40 text-ink-500 border-graphite-500/40',
  terminated: 'bg-rust-500/15 text-rust-400 border-rust-500/30',
}

function Badge({ text, cls }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {text}
    </span>
  )
}

function addDays(dateStr, days) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export default function LeasesPage() {
  const [leases, setLeases] = useState([])
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('Active')
  const [search, setSearch] = useState('')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingLease, setEditingLease] = useState(null)

  async function loadAll() {
    setLoading(true)
    setError(null)
    const [leasesRes, assetsRes] = await Promise.all([
      supabase
        .from('leases')
        .select('*, asset:assets(id,asset_number)')
        .order('start_date', { ascending: false }),
      supabase.from('assets').select('id, asset_number').order('asset_number'),
    ])
    if (leasesRes.error) setError(leasesRes.error.message)
    setLeases(leasesRes.data || [])
    setAssets(assetsRes.data || [])
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const in30Days = addDays(today, 30)

  const counts = useMemo(() => {
    const active = leases.filter((l) => l.status === 'active')
    return {
      active: active.length,
      expiringSoon: active.filter((l) => l.end_date && l.end_date <= in30Days && l.end_date >= today)
        .length,
      ended: leases.filter((l) => l.status !== 'active').length,
    }
  }, [leases, today, in30Days])

  const filtered = useMemo(() => {
    return leases.filter((l) => {
      if (tab === 'Active' && l.status !== 'active') return false
      if (tab === 'Ended' && l.status === 'active') return false
      if (search) {
        const q = search.toLowerCase()
        const hay = [l.lessee, l.asset?.asset_number].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [leases, tab, search])

  function openAdd() {
    setEditingLease(null)
    setDrawerOpen(true)
  }
  function openEdit(l) {
    setEditingLease(l)
    setDrawerOpen(true)
  }
  function closeDrawer() {
    setDrawerOpen(false)
    setEditingLease(null)
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
            <h1 className="text-xl font-semibold text-ink-100">Leases</h1>
            <p className="mt-0.5 text-sm text-ink-500">
              {loading ? 'Loading…' : `${filtered.length} of ${leases.length} leases`}
            </p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
          >
            <Plus size={16} /> New lease
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <SummaryCard icon={FileSignature} label="Active leases" value={counts.active} />
          <SummaryCard
            icon={AlertTriangle}
            label="Expiring in 30 days"
            value={counts.expiringSoon}
            accent="amber"
          />
          <SummaryCard icon={XCircle} label="Ended" value={counts.ended} />
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
              placeholder="Search lessee, asset…"
              className="w-64 rounded border border-graphite-600 bg-graphite-900 py-1.5 pl-8 pr-3 text-sm text-ink-100 placeholder:text-ink-500 outline-none focus:border-amber-400/60"
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-4">
        {error && (
          <div className="mb-4 rounded border border-rust-500/30 bg-rust-500/10 px-4 py-3 text-sm text-rust-400">
            {error.includes('relation') || error.includes('does not exist')
              ? "Couldn't find the leases table yet — run supabase/migrations/006_rentals_leases.sql in your Supabase project's SQL editor, then reload."
              : error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded border border-dashed border-graphite-600 py-16 text-center">
            <FileSignature size={28} className="mb-2 text-ink-500" />
            <p className="text-ink-300">
              {leases.length === 0 ? 'No leases yet.' : 'No leases match this view.'}
            </p>
            {leases.length === 0 && (
              <button
                onClick={openAdd}
                className="mt-3 rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
              >
                Create your first lease
              </button>
            )}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="overflow-x-auto rounded border border-graphite-800">
            <table className="w-full min-w-[820px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-48" />
                <col className="w-32" />
                <col className="w-28" />
                <col className="w-32" />
                <col className="w-32" />
                <col className="w-28" />
              </colgroup>
              <thead>
                <tr className="border-b border-graphite-700 bg-graphite-800/60 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="py-2 pl-3 pr-3 font-medium">Lessee</th>
                  <th className="py-2 pr-3 font-medium">Asset</th>
                  <th className="py-2 pr-3 font-medium">Monthly rate</th>
                  <th className="py-2 pr-3 font-medium">Start</th>
                  <th className="py-2 pr-3 font-medium">End</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => {
                  const expiringSoon =
                    l.status === 'active' && l.end_date && l.end_date <= in30Days && l.end_date >= today
                  return (
                    <tr
                      key={l.id}
                      onClick={() => openEdit(l)}
                      className="cursor-pointer border-b border-graphite-800 hover:bg-graphite-800/60"
                    >
                      <td className="truncate py-2.5 pl-3 pr-3 text-ink-100" title={l.lessee}>
                        {l.lessee}
                      </td>
                      <td className="truncate py-2.5 pr-3 font-mono text-ink-300">
                        {l.asset_id ? (
                          <Link
                            to={`/assets/${l.asset_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:text-amber-400 hover:underline"
                          >
                            {l.asset?.asset_number || '—'}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-ink-500">
                        {l.monthly_rate != null ? `$${Number(l.monthly_rate).toLocaleString()}/mo` : '—'}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-ink-500">{l.start_date}</td>
                      <td
                        className={`py-2.5 pr-3 font-mono ${expiringSoon ? 'text-amber-400' : 'text-ink-500'}`}
                      >
                        {l.end_date || '—'}
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge text={l.status} cls={STATUS_STYLES[l.status]} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawerOpen && (
        <LeaseDrawer
          lease={editingLease}
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
