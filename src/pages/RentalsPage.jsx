import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, CalendarClock, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import RentalDrawer from '../components/RentalDrawer'

const TABS = ['Active', 'All', 'Returned']

const STATUS_STYLES = {
  active: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  returned: 'bg-graphite-600/40 text-ink-500 border-graphite-500/40',
}

function Badge({ text, cls }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {text}
    </span>
  )
}

export default function RentalsPage() {
  const [rentals, setRentals] = useState([])
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('Active')
  const [search, setSearch] = useState('')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingRental, setEditingRental] = useState(null)

  async function loadAll() {
    setLoading(true)
    setError(null)
    const [rentalsRes, assetsRes] = await Promise.all([
      supabase
        .from('rentals')
        .select('*, asset:assets(id,asset_number)')
        .order('start_date', { ascending: false }),
      supabase.from('assets').select('id, asset_number').order('asset_number'),
    ])
    if (rentalsRes.error) setError(rentalsRes.error.message)
    setRentals(rentalsRes.data || [])
    setAssets(assetsRes.data || [])
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
  }, [])

  const today = new Date().toISOString().slice(0, 10)

  const counts = useMemo(() => {
    const active = rentals.filter((r) => r.status === 'active')
    return {
      active: active.length,
      overdue: active.filter((r) => r.end_date && r.end_date < today).length,
      returned: rentals.filter((r) => r.status === 'returned').length,
    }
  }, [rentals, today])

  const filtered = useMemo(() => {
    return rentals.filter((r) => {
      if (tab === 'Active' && r.status !== 'active') return false
      if (tab === 'Returned' && r.status !== 'returned') return false
      if (search) {
        const q = search.toLowerCase()
        const hay = [r.renter, r.asset?.asset_number].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rentals, tab, search])

  function openAdd() {
    setEditingRental(null)
    setDrawerOpen(true)
  }
  function openEdit(r) {
    setEditingRental(r)
    setDrawerOpen(true)
  }
  function closeDrawer() {
    setDrawerOpen(false)
    setEditingRental(null)
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
            <h1 className="text-xl font-semibold text-ink-100">Rentals</h1>
            <p className="mt-0.5 text-sm text-ink-500">
              {loading ? 'Loading…' : `${filtered.length} of ${rentals.length} rentals`}
            </p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
          >
            <Plus size={16} /> New rental
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <SummaryCard icon={CalendarClock} label="Active rentals" value={counts.active} />
          <SummaryCard icon={AlertTriangle} label="Overdue return" value={counts.overdue} accent="rust" />
          <SummaryCard icon={CheckCircle2} label="Returned" value={counts.returned} />
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
              placeholder="Search renter, asset…"
              className="w-64 rounded border border-graphite-600 bg-graphite-900 py-1.5 pl-8 pr-3 text-sm text-ink-100 placeholder:text-ink-500 outline-none focus:border-amber-400/60"
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-4">
        {error && (
          <div className="mb-4 rounded border border-rust-500/30 bg-rust-500/10 px-4 py-3 text-sm text-rust-400">
            {error.includes('relation') || error.includes('does not exist')
              ? "Couldn't find the rentals table yet — run supabase/migrations/006_rentals_leases.sql in your Supabase project's SQL editor, then reload."
              : error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded border border-dashed border-graphite-600 py-16 text-center">
            <CalendarClock size={28} className="mb-2 text-ink-500" />
            <p className="text-ink-300">
              {rentals.length === 0 ? 'No rentals yet.' : 'No rentals match this view.'}
            </p>
            {rentals.length === 0 && (
              <button
                onClick={openAdd}
                className="mt-3 rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
              >
                Create your first rental
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
                  <th className="py-2 pl-3 pr-3 font-medium">Renter</th>
                  <th className="py-2 pr-3 font-medium">Asset</th>
                  <th className="py-2 pr-3 font-medium">Rate</th>
                  <th className="py-2 pr-3 font-medium">Start</th>
                  <th className="py-2 pr-3 font-medium">End</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const overdue = r.status === 'active' && r.end_date && r.end_date < today
                  return (
                    <tr
                      key={r.id}
                      onClick={() => openEdit(r)}
                      className="cursor-pointer border-b border-graphite-800 hover:bg-graphite-800/60"
                    >
                      <td className="truncate py-2.5 pl-3 pr-3 text-ink-100" title={r.renter}>
                        {r.renter}
                      </td>
                      <td className="truncate py-2.5 pr-3 font-mono text-ink-300">
                        {r.asset_id ? (
                          <Link
                            to={`/assets/${r.asset_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:text-amber-400 hover:underline"
                          >
                            {r.asset?.asset_number || '—'}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-ink-500">
                        {r.rate != null ? `$${Number(r.rate).toLocaleString()}/${r.rate_period}` : '—'}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-ink-500">{r.start_date}</td>
                      <td className={`py-2.5 pr-3 font-mono ${overdue ? 'text-rust-400' : 'text-ink-500'}`}>
                        {r.end_date || '—'}
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge text={r.status} cls={STATUS_STYLES[r.status]} />
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
        <RentalDrawer
          rental={editingRental}
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
