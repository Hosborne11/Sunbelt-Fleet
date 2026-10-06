import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, Pencil, Plus, Search, Wrench, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { iconFor } from '../lib/categoryIcons'
import StatusBadge from '../components/StatusBadge'
import AssetDrawer from '../components/AssetDrawer'
import MapView from '../components/MapView'
import MaintenancePlanDrawer from '../components/MaintenancePlanDrawer'
import { DUE_SOON_HOURS, fmtDate } from '../lib/maintenanceDue'
import { fetchTelematicsByAsset, reportingMeta, timeAgo } from '../lib/telematics'

const SPLIT_KEY = 'fleet.assets.split'
const TELEMATICS_REFRESH_MS = 5 * 60 * 1000

// Sortable columns: how to read each value (nulls always sort last)
const SORTS = {
  asset_number: (a) => a.asset_number,
  jobsite: (a) => a.jobsite?.name ?? null,
  last_report: (a, t) => (t?.last_report_at ? new Date(t.last_report_at).getTime() : null),
  today: (a, t) => t?.hours_today ?? null,
  yesterday: (a, t) => t?.hours_yesterday ?? null,
  week: (a, t) => t?.hours_7d ?? null,
  hour_meter: (a) => a.hour_meter ?? null,
  next_pm: (a, t, pm) => (pm?.hours_until_due != null ? Number(pm.hours_until_due) : null),
}

const pmFlagged = (pm) => pm && (pm.status === 'due_soon' || pm.status === 'overdue')
const pmNeedsDate = (pm) => pmFlagged(pm) && !pm.scheduled_for && !pm.request_status

export default function AssetsPage() {
  const [assets, setAssets] = useState([])
  const [categories, setCategories] = useState([])
  const [jobsites, setJobsites] = useState([])
  const [telematics, setTelematics] = useState({})
  const [pms, setPms] = useState({})
  const [pmOnly, setPmOnly] = useState(false)
  const [openPlan, setOpenPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [search, setSearch] = useState('')
  const [jobsiteFilter, setJobsiteFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [crewFilter, setCrewFilter] = useState('')
  const [crews, setCrews] = useState([])
  const [sort, setSort] = useState({ key: 'asset_number', dir: 'asc' })

  const [selectedId, setSelectedId] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingAsset, setEditingAsset] = useState(null)

  const [split, setSplit] = useState(() => {
    const saved = Number(window.localStorage.getItem(SPLIT_KEY))
    return saved >= 35 && saved <= 75 ? saved : 60
  })
  const splitRef = useRef(null)
  const rowRefs = useRef({})

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [assetsRes, catRes, jobsiteRes, telRes, pmRes, crewRes] = await Promise.all([
      supabase
        .from('assets')
        .select('*, category:equipment_categories(id,name,icon), jobsite:jobsites(id,name), crew:crews(id,name)')
        .order('asset_number'),
      supabase.from('equipment_categories').select('*').order('sort_order'),
      supabase.from('jobsites').select('*').order('name'),
      fetchTelematicsByAsset(),
      supabase.from('asset_next_pm').select('*'),
      supabase.from('crews').select('id, name').eq('active', true).order('sort_order'),
    ])
    setCrews(crewRes.data || [])
    if (assetsRes.error) setError(assetsRes.error.message)
    setPms(Object.fromEntries((pmRes.data || []).map((r) => [r.asset_id, r])))
    setAssets(assetsRes.data || [])
    setCategories(catRes.data || [])
    setJobsites(jobsiteRes.data || [])
    setTelematics(telRes.map)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Keep positions and hours current while the page is open
  useEffect(() => {
    const id = setInterval(async () => {
      const { map } = await fetchTelematicsByAsset()
      setTelematics(map)
    }, TELEMATICS_REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(SPLIT_KEY, String(Math.round(split)))
  }, [split])

  const filtered = useMemo(() => {
    const rows = assets.filter((a) => {
      if (jobsiteFilter && a.jobsite_id !== jobsiteFilter) return false
      if (categoryFilter && a.category_id !== categoryFilter) return false
      if (statusFilter && a.status !== statusFilter) return false
      if (crewFilter && (crewFilter === 'none' ? a.crew_id : a.crew_id !== crewFilter)) return false
      if (pmOnly && !pmFlagged(pms[a.id])) return false
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
    const get = SORTS[sort.key]
    const mult = sort.dir === 'asc' ? 1 : -1
    return rows.sort((x, y) => {
      const vx = get(x, telematics[x.id], pms[x.id])
      const vy = get(y, telematics[y.id], pms[y.id])
      if (vx == null && vy == null) return 0
      if (vx == null) return 1
      if (vy == null) return -1
      if (typeof vx === 'string') return mult * vx.localeCompare(vy, undefined, { numeric: true })
      return mult * (vx - vy)
    })
  }, [assets, telematics, pms, pmOnly, search, jobsiteFilter, categoryFilter, statusFilter, crewFilter, sort])

  const pmCounts = useMemo(() => {
    const flagged = Object.values(pms).filter(pmFlagged)
    return { due: flagged.length, unscheduled: flagged.filter(pmNeedsDate).length }
  }, [pms])

  async function openPm(planId) {
    const { data, error: err } = await supabase.from('maintenance_plans').select('*').eq('id', planId).single()
    if (err) return setError(err.message)
    setOpenPlan(data)
  }

  const totals = useMemo(() => {
    const sum = (k) => filtered.reduce((s, a) => s + (Number(telematics[a.id]?.[k]) || 0), 0)
    return { today: sum('hours_today'), yesterday: sum('hours_yesterday'), week: sum('hours_7d') }
  }, [filtered, telematics])

  function toggleSort(key) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'asset_number' || key === 'jobsite' || key === 'next_pm' ? 'asc' : 'desc' }
    )
  }

  // Selecting on the map scrolls the matching row into view
  const selectFromMap = useCallback((id) => {
    setSelectedId(id)
    rowRefs.current[id]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])

  function startDrag(e) {
    e.preventDefault()
    const rect = splitRef.current.getBoundingClientRect()
    const move = (ev) => setSplit(Math.min(75, Math.max(35, ((ev.clientX - rect.left) / rect.width) * 100)))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  function dragKeys(e) {
    if (e.key === 'ArrowLeft') setSplit((s) => Math.max(35, s - 5))
    if (e.key === 'ArrowRight') setSplit((s) => Math.min(75, s + 5))
  }

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

  const hasFilters = search || jobsiteFilter || categoryFilter || statusFilter || crewFilter || pmOnly

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-graphite-700 px-6 py-4">
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

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search asset #, make, model, serial…"
              className="w-72 rounded border border-graphite-600 bg-graphite-900 py-1.5 pl-8 pr-3 text-sm text-ink-100 outline-none placeholder:text-ink-500 focus:border-amber-400/60"
            />
          </div>
          <select value={jobsiteFilter} onChange={(e) => setJobsiteFilter(e.target.value)}
                  className="rounded border border-graphite-600 bg-graphite-900 px-2.5 py-1.5 text-sm text-ink-300">
            <option value="">All jobsites</option>
            {jobsites.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
          </select>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
                  className="rounded border border-graphite-600 bg-graphite-900 px-2.5 py-1.5 text-sm text-ink-300">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded border border-graphite-600 bg-graphite-900 px-2.5 py-1.5 text-sm text-ink-300">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="down">Down</option>
            <option value="maintenance">In service</option>
            <option value="retired">Retired</option>
          </select>
          <select value={crewFilter} onChange={(e) => setCrewFilter(e.target.value)}
                  className="rounded border border-graphite-600 bg-graphite-900 px-2.5 py-1.5 text-sm text-ink-300">
            <option value="">All crews</option>
            {crews.map((c) => <option key={c.id} value={c.id}>{c.name} crew</option>)}
            <option value="none">No crew set</option>
          </select>
          <button
            onClick={() => setPmOnly((v) => !v)}
            className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-sm ${
              pmOnly
                ? 'border-amber-400 bg-amber-400 font-medium text-graphite-950'
                : pmCounts.due > 0
                  ? 'border-amber-400/50 text-amber-400 hover:bg-amber-400/10'
                  : 'border-graphite-600 text-ink-500'
            }`}
            title={`Machines within ${DUE_SOON_HOURS} hours of a PM, or past due`}
          >
            <Wrench size={14} />
            PM due: {pmCounts.due}
            {pmCounts.unscheduled > 0 && <span className="opacity-80">({pmCounts.unscheduled} not scheduled)</span>}
          </button>
          {hasFilters && (
            <button
              onClick={() => { setSearch(''); setJobsiteFilter(''); setCategoryFilter(''); setStatusFilter(''); setCrewFilter(''); setPmOnly(false) }}
              className="flex items-center gap-1 text-sm text-ink-500 hover:text-ink-100"
            >
              <X size={14} /> Clear
            </button>
          )}
        </div>
      </header>

      <div ref={splitRef} className="flex min-h-0 flex-1 flex-col lg:flex-row" style={{ '--table-w': `${split}%` }}>
        {/* Table */}
        <section className="order-2 flex min-h-0 flex-1 flex-col lg:order-1 lg:w-[var(--table-w)] lg:flex-none">
          <div className="flex-1 overflow-auto px-4 py-3">
            {error && (
              <div className="mb-4 rounded border border-rust-500/30 bg-rust-500/10 px-4 py-3 text-sm text-rust-400">
                {error}
              </div>
            )}

            {!loading && !error && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center rounded border border-dashed border-graphite-600 py-16 text-center">
                <p className="text-ink-300">
                  {assets.length === 0 ? 'No assets in the registry yet.' : 'No assets match these filters.'}
                </p>
                {assets.length === 0 && (
                  <button onClick={openAdd}
                          className="mt-3 rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90">
                    Add your first asset
                  </button>
                )}
              </div>
            )}

            {filtered.length > 0 && (
              <div className="rounded border border-graphite-800">
                <table className="w-full min-w-[1080px] table-fixed border-collapse text-sm">
                  <colgroup>
                    <col className="w-32" />
                    <col className="w-40" />
                    <col className="w-32" />
                    <col className="w-28" />
                    <col className="w-24" />
                    <col className="w-[4.5rem]" />
                    <col className="w-[4.5rem]" />
                    <col className="w-[4.5rem]" />
                    <col className="w-20" />
                    <col className="w-32" />
                    <col className="w-9" />
                  </colgroup>
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-graphite-700 bg-graphite-800 text-left text-xs text-ink-500">
                      <Th sortKey="asset_number" sort={sort} onSort={toggleSort} className="pl-3">Asset #</Th>
                      <th className="py-2 pr-3 font-medium">Machine</th>
                      <Th sortKey="jobsite" sort={sort} onSort={toggleSort}>Jobsite</Th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <Th sortKey="last_report" sort={sort} onSort={toggleSort}>Last report</Th>
                      <Th sortKey="today" sort={sort} onSort={toggleSort} align="right" title="Machine hours since this morning's close-out">Today</Th>
                      <Th sortKey="yesterday" sort={sort} onSort={toggleSort} align="right">Yesterday</Th>
                      <Th sortKey="week" sort={sort} onSort={toggleSort} align="right" title="Today plus the previous 6 days">7 days</Th>
                      <Th sortKey="hour_meter" sort={sort} onSort={toggleSort} align="right">Meter</Th>
                      <Th sortKey="next_pm" sort={sort} onSort={toggleSort} align="right"
                          title={`Hours until the next PM. Flagged within ${DUE_SOON_HOURS} hours; click to schedule or log it.`}>
                        Next PM
                      </Th>
                      <th className="py-2" aria-label="Edit" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((a) => {
                      const Icon = iconFor(a.category?.icon)
                      const t = telematics[a.id]
                      const selected = a.id === selectedId
                      return (
                        <tr
                          key={a.id}
                          ref={(el) => { rowRefs.current[a.id] = el }}
                          onClick={() => setSelectedId(selected ? null : a.id)}
                          className={`cursor-pointer border-b border-graphite-800 ${
                            selected ? 'bg-amber-400/10 shadow-[inset_3px_0_0_#F2A93B]' : 'hover:bg-graphite-800/60'
                          }`}
                        >
                          <td className="truncate py-2.5 pl-3 pr-3 font-mono text-ink-100" title={a.asset_number}>
                            <span className="flex items-center gap-2">
                              <Icon size={15} strokeWidth={1.75} className="shrink-0 text-ink-500" />
                              <Link to={`/assets/${a.id}`} onClick={(e) => e.stopPropagation()}
                                    className="truncate hover:text-amber-400 hover:underline">
                                {a.asset_number}
                              </Link>
                            </span>
                          </td>
                          <td className="py-2 pr-3">
                            <div className="truncate text-ink-300" title={[a.make, a.model].filter(Boolean).join(' ')}>
                              {[a.make, a.model].filter(Boolean).join(' ') || '—'}
                            </div>
                            {a.serial_number && (
                              <div className="truncate font-mono text-xs text-ink-500" title={a.serial_number}>
                                {a.serial_number}
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-3" title={a.jobsite?.name || ''}>
                            <div className="truncate text-ink-300">{a.jobsite?.name || 'Unassigned'}</div>
                            <CrewTag crew={a.crew} />
                          </td>
                          <td className="whitespace-nowrap py-2.5 pr-3"><StatusBadge status={a.status} /></td>
                          <td className="whitespace-nowrap py-2.5 pr-3 text-xs"><LastReport t={t} /></td>
                          <HoursCell value={t?.hours_today} />
                          <HoursCell value={t?.hours_yesterday} />
                          <HoursCell value={t?.hours_7d} />
                          <td className="whitespace-nowrap py-2.5 pr-3 text-right font-mono text-ink-500">
                            {a.hour_meter != null ? Math.round(a.hour_meter).toLocaleString() : '—'}
                          </td>
                          <NextPmCell pm={pms[a.id]} onOpen={openPm} />
                          <td className="py-2.5 pr-2 text-right">
                            <button
                              onClick={(e) => { e.stopPropagation(); openEdit(a) }}
                              className="rounded p-1 text-ink-500 hover:bg-graphite-700 hover:text-ink-100"
                              title="Edit asset"
                              aria-label={`Edit ${a.asset_number}`}
                            >
                              <Pencil size={14} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot className="sticky bottom-0">
                    <tr className="border-t border-graphite-700 bg-graphite-800 text-sm">
                      <td colSpan={5} className="py-2 pl-3 pr-3 text-ink-500">
                        Total, {filtered.length} asset{filtered.length === 1 ? '' : 's'}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-ink-100">{totals.today.toFixed(1)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-ink-100">{totals.yesterday.toFixed(1)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-ink-100">{totals.week.toFixed(1)}</td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* Divider (drag or use arrow keys) */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize table and map"
          tabIndex={0}
          onMouseDown={startDrag}
          onKeyDown={dragKeys}
          className="hidden w-1.5 shrink-0 cursor-col-resize bg-graphite-800 transition-colors hover:bg-amber-400/50 focus-visible:bg-amber-400/50 focus-visible:outline-none lg:order-2 lg:block"
        />

        {/* Map */}
        <section className="order-1 h-72 min-w-0 border-b border-graphite-700 lg:order-3 lg:h-auto lg:flex-1 lg:border-b-0">
          <MapView
            jobsites={jobsites}
            assets={filtered}
            telematics={telematics}
            selectedId={selectedId}
            onSelect={selectFromMap}
          />
        </section>
      </div>

      {openPlan && (
        <MaintenancePlanDrawer
          plan={openPlan}
          assets={assets}
          onClose={() => setOpenPlan(null)}
          onSaved={() => { setOpenPlan(null); loadAll() }}
          onDeleted={() => { setOpenPlan(null); loadAll() }}
        />
      )}

      {drawerOpen && (
        <AssetDrawer
          asset={editingAsset}
          categories={categories}
          jobsites={jobsites}
          onClose={closeDrawer}
          onSaved={onSaved}
          onDeleted={onSaved}
        />
      )}
    </div>
  )
}

function Th({ sortKey, sort, onSort, align, className = '', title, children }) {
  const active = sort.key === sortKey
  const Arrow = sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th className={`py-2 pr-3 font-medium ${align === 'right' ? 'text-right' : ''} ${className}`} title={title}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-ink-100 ${active ? 'text-ink-100' : ''} ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        {children}
        {active && <Arrow size={12} />}
      </button>
    </th>
  )
}

function HoursCell({ value }) {
  if (value == null) return <td className="py-2.5 pr-3 text-right font-mono text-ink-500">—</td>
  const n = Number(value)
  return (
    <td className={`py-2.5 pr-3 text-right font-mono ${n > 0 ? 'text-ink-100' : 'text-ink-500'}`}>
      {n.toFixed(1)}
    </td>
  )
}

function LastReport({ t }) {
  if (!t) return <span className="text-ink-500" title="No telematics linked to this serial number">—</span>
  const meta = reportingMeta(t.reporting_status)
  return (
    <span className="flex items-center gap-1.5 text-ink-300" title={meta.label}>
      <span className={`h-2 w-2 shrink-0 rounded-sm ${meta.dot}`} />
      {timeAgo(t.last_report_at)}
    </span>
  )
}

function NextPmCell({ pm, onOpen }) {
  if (!pm || pm.hours_until_due == null) {
    return <td className="py-2.5 pr-3 text-right font-mono text-ink-500" title="Needs an hour meter reading">—</td>
  }
  const h = Number(pm.hours_until_due)
  const overdue = pm.status === 'overdue'
  const flagged = pmFlagged(pm)
  const color = overdue ? 'text-rust-400' : flagged ? 'text-amber-400' : 'text-ink-300'
  return (
    <td className="py-2 pr-3 text-right">
      <button
        onClick={(e) => { e.stopPropagation(); onOpen(pm.plan_id) }}
        className="inline-flex items-center justify-end gap-1.5 rounded px-1 py-0.5 hover:bg-graphite-700"
        title={`${pm.name}: due at ${Math.round(pm.next_due_hours).toLocaleString()} hrs${pm.last_service_assumed ? ' (last PM not recorded, assumed)' : ''}`}
      >
        <span className={`font-mono ${color}`}>{overdue ? `${Math.abs(Math.round(h))} over` : Math.round(h)}</span>
        {pm.request_status === 'requested' && (
          <span className="rounded border border-amber-400/50 px-1.5 text-[11px] text-amber-400" title="Requested from the vendor; waiting for a date">
            Requested
          </span>
        )}
        {pm.request_status === 'awaiting_confirmation' && (
          <span className="rounded border border-amber-400/50 px-1.5 text-[11px] text-amber-400" title="Service date passed; waiting for the vendor to confirm">
            Confirm?
          </span>
        )}
        {!pm.request_status && flagged && !pm.scheduled_for && (
          <span className={`rounded px-1.5 text-[11px] font-medium text-graphite-950 ${overdue ? 'bg-rust-400' : 'bg-amber-400'}`}>
            Schedule
          </span>
        )}
        {(pm.request_status === 'scheduled' || (!pm.request_status && flagged && pm.scheduled_for)) && (
          <span className="rounded border border-teal-500/40 px-1.5 text-[11px] text-teal-400">{fmtDate(pm.scheduled_for || pm.request_scheduled_date)}</span>
        )}
      </button>
    </td>
  )
}

function CrewTag({ crew }) {
  if (!crew) return <div className="text-xs text-ink-500">No crew</div>
  const pipe = crew.name.toLowerCase() === 'pipe'
  return (
    <span className={`mt-0.5 inline-block rounded px-1.5 text-[11px] font-medium ${pipe ? 'bg-sky-500/15 text-sky-300' : 'bg-amber-400/15 text-amber-400'}`}>
      {crew.name} crew
    </span>
  )
}
