import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, CalendarRange } from 'lucide-react'
import { supabase } from '../lib/supabase'
import ReservationDrawer from '../components/ReservationDrawer'

const TABS = ['Upcoming', 'All', 'Cancelled']

const STATUS_STYLES = {
  pending: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  confirmed: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  cancelled: 'bg-graphite-600/40 text-ink-500 border-graphite-500/40',
}

function Badge({ text, cls }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {text}
    </span>
  )
}

export default function ReservationsPage() {
  const [reservations, setReservations] = useState([])
  const [assets, setAssets] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('Upcoming')
  const [search, setSearch] = useState('')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingReservation, setEditingReservation] = useState(null)

  async function loadAll() {
    setLoading(true)
    setError(null)
    const [resRes, assetsRes, catsRes] = await Promise.all([
      supabase
        .from('reservations')
        .select('*, asset:assets(asset_number), category:equipment_categories(name)')
        .order('from_date', { ascending: true }),
      supabase.from('assets').select('id, asset_number').order('asset_number'),
      supabase.from('equipment_categories').select('id, name').order('sort_order'),
    ])
    if (resRes.error) setError(resRes.error.message)
    setReservations(resRes.data || [])
    setAssets(assetsRes.data || [])
    setCategories(catsRes.data || [])
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
  }, [])

  const today = new Date().toISOString().slice(0, 10)

  const filtered = useMemo(() => {
    return reservations.filter((r) => {
      if (tab === 'Upcoming' && (r.status === 'cancelled' || (r.to_date && r.to_date < today)))
        return false
      if (tab === 'Cancelled' && r.status !== 'cancelled') return false
      if (search) {
        const q = search.toLowerCase()
        const hay = [r.asset?.asset_number, r.category?.name, r.requester, r.location]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [reservations, tab, search, today])

  function openAdd() {
    setEditingReservation(null)
    setDrawerOpen(true)
  }
  function openEdit(r) {
    setEditingReservation(r)
    setDrawerOpen(true)
  }
  function closeDrawer() {
    setDrawerOpen(false)
    setEditingReservation(null)
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
            <h1 className="text-xl font-semibold text-ink-100">Reservations</h1>
            <p className="mt-0.5 text-sm text-ink-500">
              {loading ? 'Loading…' : `${filtered.length} of ${reservations.length} reservations`}
            </p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
          >
            <Plus size={16} /> New reservation
          </button>
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
              placeholder="Search asset, category, requester…"
              className="w-64 rounded border border-graphite-600 bg-graphite-900 py-1.5 pl-8 pr-3 text-sm text-ink-100 placeholder:text-ink-500 outline-none focus:border-amber-400/60"
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-4">
        {error && (
          <div className="mb-4 rounded border border-rust-500/30 bg-rust-500/10 px-4 py-3 text-sm text-rust-400">
            {error.includes('relation') || error.includes('does not exist')
              ? "Couldn't find the reservations table yet — run supabase/migrations/007_reservations_contacts.sql in your Supabase project's SQL editor, then reload."
              : error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded border border-dashed border-graphite-600 py-16 text-center">
            <CalendarRange size={28} className="mb-2 text-ink-500" />
            <p className="text-ink-300">
              {reservations.length === 0 ? 'No reservations yet.' : 'No reservations match this view.'}
            </p>
            {reservations.length === 0 && (
              <button
                onClick={openAdd}
                className="mt-3 rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
              >
                Create your first reservation
              </button>
            )}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="overflow-x-auto rounded border border-graphite-800">
            <table className="w-full min-w-[820px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-32" />
                <col className="w-32" />
                <col className="w-36" />
                <col className="w-40" />
                <col className="w-32" />
                <col className="w-28" />
              </colgroup>
              <thead>
                <tr className="border-b border-graphite-700 bg-graphite-800/60 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="py-2 pl-3 pr-3 font-medium">From</th>
                  <th className="py-2 pr-3 font-medium">To</th>
                  <th className="py-2 pr-3 font-medium">Asset / Category</th>
                  <th className="py-2 pr-3 font-medium">Location</th>
                  <th className="py-2 pr-3 font-medium">Requester</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => openEdit(r)}
                    className="cursor-pointer border-b border-graphite-800 hover:bg-graphite-800/60"
                  >
                    <td className="py-2.5 pl-3 pr-3 font-mono text-ink-500">{r.from_date}</td>
                    <td className="py-2.5 pr-3 font-mono text-ink-500">{r.to_date || '—'}</td>
                    <td className="truncate py-2.5 pr-3 text-ink-100">
                      {r.asset?.asset_number || r.category?.name || '—'}
                    </td>
                    <td className="truncate py-2.5 pr-3 text-ink-300">{r.location || '—'}</td>
                    <td className="truncate py-2.5 pr-3 text-ink-300">{r.requester || '—'}</td>
                    <td className="py-2.5 pr-3">
                      <Badge text={r.status} cls={STATUS_STYLES[r.status]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawerOpen && (
        <ReservationDrawer
          reservation={editingReservation}
          assets={assets}
          categories={categories}
          onClose={closeDrawer}
          onSaved={onSaved}
          onDeleted={onDeleted}
        />
      )}
    </div>
  )
}
