import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, X, Table2, Map as MapIcon } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { iconFor } from '../lib/categoryIcons'
import StatusBadge from '../components/StatusBadge'
import AssetDrawer from '../components/AssetDrawer'
import MapView from '../components/MapView'

const VIEWS = [
  { key: 'table', label: 'Table', icon: Table2 },
  { key: 'map', label: 'Map', icon: MapIcon },
]

export default function AssetsPage() {
  const [assets, setAssets] = useState([])
  const [categories, setCategories] = useState([])
  const [jobsites, setJobsites] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [view, setView] = useState('table')

  const [search, setSearch] = useState('')
  const [jobsiteFilter, setJobsiteFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingAsset, setEditingAsset] = useState(null)

  async function loadAll() {
    setLoading(true)
    setError(null)
    const [assetsRes, catRes, jobsiteRes] = await Promise.all([
      supabase
        .from('assets')
        .select('*, category:equipment_categories(id,name,icon), jobsite:jobsites(id,name)')
        .order('asset_number'),
      supabase.from('equipment_categories').select('*').order('sort_order'),
      supabase.from('jobsites').select('*').order('name'),
    ])

    if (assetsRes.error) setError(assetsRes.error.message)
    setAssets(assetsRes.data || [])
    setCategories(catRes.data || [])
    setJobsites(jobsiteRes.data || [])
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
  }, [])

  const filtered = useMemo(() => {
    return assets.filter((a) => {
      if (jobsiteFilter && a.jobsite_id !== jobsiteFilter) return false
      if (categoryFilter && a.category_id !== categoryFilter) return false
      if (statusFilter && a.status !== statusFilter) return false
      if (search) {
        const q = search.toLowerCase()
        const hay = [a.asset_number, a.make, a.model, a.serial_number, a.jobsite?.name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [assets, search, jobsiteFilter, categoryFilter, statusFilter])

  function openAdd() {
    setEditingAsset(null)
    setDrawerOpen(true)
  }
  function openEdit(asset) {
    setEditingAsset(asset)
    setDrawerOpen(true)
  }
  function closeDrawer() {
    setDrawerOpen(false)
    setEditingAsset(null)
  }
  function onSaved() {
    closeDrawer()
    loadAll()
  }
  function onDeleted() {
    closeDrawer()
    loadAll()
  }

  const hasFilters = search || jobsiteFilter || categoryFilter || statusFilter

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-graphite-700 px-6 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-ink-100">Machine registry</h1>
            <p className="mt-0.5 text-sm text-ink-500">
              {loading ? 'Loading…' : `${filtered.length} of ${assets.length} assets`}
            </p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
          >
            <Plus size={16} /> Add asset
          </button>
        </div>

        <div className="mt-4 flex items-center gap-1 rounded border border-graphite-700 bg-graphite-900 p-1 w-fit">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors ${
                view === v.key
                  ? 'bg-amber-400 text-graphite-950 font-medium'
                  : 'text-ink-300 hover:text-ink-100'
              }`}
            >
              <v.icon size={14} strokeWidth={1.75} />
              {v.label}
            </button>
          ))}
        </div>

        {view === 'table' && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search asset #, make, model, serial…"
              className="w-72 rounded border border-graphite-600 bg-graphite-900 py-1.5 pl-8 pr-3 text-sm text-ink-100 placeholder:text-ink-500 outline-none focus:border-amber-400/60"
            />
          </div>

          <select
            value={jobsiteFilter}
            onChange={(e) => setJobsiteFilter(e.target.value)}
            className="rounded border border-graphite-600 bg-graphite-900 px-2.5 py-1.5 text-sm text-ink-300"
          >
            <option value="">All jobsites</option>
            {jobsites.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded border border-graphite-600 bg-graphite-900 px-2.5 py-1.5 text-sm text-ink-300"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded border border-graphite-600 bg-graphite-900 px-2.5 py-1.5 text-sm text-ink-300"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="down">Down</option>
            <option value="maintenance">In service</option>
            <option value="retired">Retired</option>
          </select>

          {hasFilters && (
            <button
              onClick={() => {
                setSearch('')
                setJobsiteFilter('')
                setCategoryFilter('')
                setStatusFilter('')
              }}
              className="flex items-center gap-1 text-sm text-ink-500 hover:text-ink-100"
            >
              <X size={14} /> Clear
            </button>
          )}
        </div>
        )}
      </header>

      {view === 'map' && (
        <div className="flex-1 overflow-hidden">
          <MapView jobsites={jobsites} assets={assets} />
        </div>
      )}

      {view === 'table' && (
      <div className="flex-1 overflow-auto px-6 py-4">
        {error && (
          <div className="mb-4 rounded border border-rust-500/30 bg-rust-500/10 px-4 py-3 text-sm text-rust-400">
            {error.includes('relation') || error.includes('does not exist')
              ? "Couldn't find the assets table yet — run supabase/schema.sql in your Supabase project's SQL editor, then reload."
              : error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded border border-dashed border-graphite-600 py-16 text-center">
            <p className="text-ink-300">
              {assets.length === 0 ? 'No assets in the registry yet.' : 'No assets match these filters.'}
            </p>
            {assets.length === 0 && (
              <button
                onClick={openAdd}
                className="mt-3 rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
              >
                Add your first asset
              </button>
            )}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="overflow-x-auto rounded border border-graphite-800">
            <table className="w-full min-w-[900px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-10" />
                <col className="w-40" />
                <col className="w-32" />
                <col className="w-32" />
                <col className="w-40" />
                <col className="w-48" />
                <col className="w-28" />
                <col className="w-20" />
              </colgroup>
              <thead>
                <tr className="border-b border-graphite-700 bg-graphite-800/60 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="py-2 pl-3 pr-3 font-medium">Cat.</th>
                  <th className="py-2 pr-3 font-medium">Asset #</th>
                  <th className="py-2 pr-3 font-medium">Make</th>
                  <th className="py-2 pr-3 font-medium">Model</th>
                  <th className="py-2 pr-3 font-medium">Serial #</th>
                  <th className="py-2 pr-3 font-medium">Jobsite</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 text-right font-medium">Hours</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => {
                  const Icon = iconFor(a.category?.icon)
                  return (
                    <tr
                      key={a.id}
                      onClick={() => openEdit(a)}
                      className="cursor-pointer border-b border-graphite-800 hover:bg-graphite-800/60"
                    >
                      <td className="py-2.5 pl-3 pr-3 text-ink-500">
                        <Icon size={16} strokeWidth={1.75} title={a.category?.name} />
                      </td>
                      <td
                        className="truncate py-2.5 pr-3 font-mono text-ink-100"
                        title={a.asset_number}
                      >
                        <Link
                          to={`/assets/${a.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-amber-400 hover:underline"
                        >
                          {a.asset_number}
                        </Link>
                      </td>
                      <td className="truncate py-2.5 pr-3 text-ink-300" title={a.make || ''}>
                        {a.make || '—'}
                      </td>
                      <td className="truncate py-2.5 pr-3 text-ink-300" title={a.model || ''}>
                        {a.model || '—'}
                      </td>
                      <td
                        className="truncate py-2.5 pr-3 font-mono text-ink-500"
                        title={a.serial_number || ''}
                      >
                        {a.serial_number || '—'}
                      </td>
                      <td
                        className="truncate py-2.5 pr-3 text-ink-300"
                        title={a.jobsite?.name || ''}
                      >
                        {a.jobsite?.name || 'Unassigned'}
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-3">
                        <StatusBadge status={a.status} />
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-right font-mono text-ink-500">
                        {a.hour_meter != null ? a.hour_meter.toLocaleString() : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {drawerOpen && (
        <AssetDrawer
          asset={editingAsset}
          categories={categories}
          jobsites={jobsites}
          onClose={closeDrawer}
          onSaved={onSaved}
          onDeleted={onDeleted}
        />
      )}
    </div>
  )
}
