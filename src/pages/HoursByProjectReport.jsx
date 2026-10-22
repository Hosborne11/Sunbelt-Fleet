import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, Download, Loader2, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { toCSV, downloadCSV } from '../lib/reports'

// ---------- dates (local calendar days, YYYY-MM-DD) ----------
const iso = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
const addDays = (d, n) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
function presets() {
  const today = new Date()
  const dow = (today.getDay() + 6) % 7 // Monday = 0
  const weekStart = addDays(today, -dow)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const lastMonthEnd = addDays(monthStart, -1)
  return [
    { label: 'This week', from: iso(weekStart), to: iso(today) },
    { label: 'Last week', from: iso(addDays(weekStart, -7)), to: iso(addDays(weekStart, -1)) },
    { label: 'This month', from: iso(monthStart), to: iso(today) },
    { label: 'Last month', from: iso(lastMonthStart), to: iso(lastMonthEnd) },
    { label: 'Last 30 days', from: iso(addDays(today, -29)), to: iso(today) },
    { label: 'Year to date', from: `${today.getFullYear()}-01-01`, to: iso(today) },
  ]
}
const fmtDate = (s) =>
  new Date(`${s}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

// ---------- numbers ----------
const hrs = (v) => (v == null ? '—' : Number(v).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
const money = (v) => (v == null ? '—' : Number(v).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }))
const sum = (rows, k) => rows.reduce((t, r) => t + (r[k] == null ? 0 : Number(r[k])), 0)
const anyValue = (rows, k) => rows.some((r) => r[k] != null)

const machineName = (a) => [a.make, a.model].filter(Boolean).join(' ')
const machineLabel = (a) => [a.asset_number, machineName(a)].filter(Boolean).join(' - ')
const byNumber = (a, b) =>
  String(a.asset_number || '').localeCompare(String(b.asset_number || ''), undefined, { numeric: true })

export default function HoursByProjectReport() {
  const ranges = useMemo(() => presets(), [])
  const [from, setFrom] = useState(ranges[2].from)
  const [to, setTo] = useState(ranges[2].to)

  const [assets, setAssets] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [q, setQ] = useState('')
  const [showRetired, setShowRetired] = useState(false)

  const [rows, setRows] = useState(null)
  const [ranFor, setRanFor] = useState(null)
  const [view, setView] = useState('machine')
  const [running, setRunning] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    supabase
      .from('assets')
      .select('id, asset_number, make, model, status, category:equipment_categories(name), crew:crews(name)')
      .not('telematics_asset_id', 'is', null)
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        setAssets((data || []).sort(byNumber))
      })
  }, [])

  const pool = useMemo(
    () => (assets || []).filter((a) => showRetired || a.status !== 'retired'),
    [assets, showRetired],
  )
  const needle = q.trim().toLowerCase()
  const shown = needle
    ? pool.filter((a) => [a.asset_number, a.make, a.model, a.category?.name, a.crew?.name]
        .filter(Boolean).join(' ').toLowerCase().includes(needle))
    : pool
  const groups = useMemo(() => {
    const cats = new Map()
    for (const a of pool) if (a.category?.name) cats.set(a.category.name, (cats.get(a.category.name) || 0) + 1)
    const crews = new Map()
    for (const a of pool) if (a.crew?.name) crews.set(a.crew.name, (crews.get(a.crew.name) || 0) + 1)
    return {
      categories: [...cats.entries()].sort((x, y) => x[0].localeCompare(y[0])),
      crews: [...crews.entries()].sort((x, y) => x[0].localeCompare(y[0])),
    }
  }, [pool])

  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const addMany = (list) => setSelected((s) => new Set([...s, ...list.map((a) => a.id)]))

  async function run() {
    setError(null)
    if (!selected.size) return setError('Pick at least one asset.')
    if (!from || !to || from > to) return setError('Pick a start date on or before the end date.')
    setRunning(true)
    const ids = [...selected]
    const { data, error: err } = await supabase.rpc('report_hours_by_project', { p_assets: ids, p_from: from, p_to: to })
    setRunning(false)
    if (err) return setError(err.message)
    setRows(data || [])
    setRanFor({ ids, from, to })
  }

  // ---------- shape the results ----------
  const assetById = useMemo(() => Object.fromEntries((assets || []).map((a) => [a.id, a])), [assets])
  const byMachine = useMemo(() => {
    if (!rows || !ranFor) return []
    return ranFor.ids
      .map((id) => assetById[id])
      .filter(Boolean)
      .sort(byNumber)
      .map((a) => {
        const own = rows.filter((r) => r.asset_id === a.id)
          .sort((x, y) => Number(y.engine_hours) - Number(x.engine_hours) || x.jobsite.localeCompare(y.jobsite))
        return { asset: a, rows: own }
      })
  }, [rows, ranFor, assetById])
  const byProject = useMemo(() => {
    if (!rows) return []
    const m = new Map()
    for (const r of rows) {
      const key = `${r.project_id || 'none'}|${r.jobsite}`
      const g = m.get(key) || { jobsite: r.jobsite, job_number: r.job_number, machines: new Set(), rows: [] }
      g.machines.add(r.asset_id)
      g.rows.push(r)
      m.set(key, g)
    }
    return [...m.values()]
      .map((g) => ({ ...g, engine_hours: sum(g.rows, 'engine_hours'), hours_on_site: anyValue(g.rows, 'hours_on_site') ? sum(g.rows, 'hours_on_site') : null, tm_amount: anyValue(g.rows, 'tm_amount') ? sum(g.rows, 'tm_amount') : null }))
      .sort((x, y) => (x.jobsite === 'No jobsite') - (y.jobsite === 'No jobsite') || y.engine_hours - x.engine_hours)
  }, [rows])

  const totals = rows
    ? {
        engine: sum(rows, 'engine_hours'),
        onSite: anyValue(rows, 'hours_on_site') ? sum(rows, 'hours_on_site') : null,
        tm: anyValue(rows, 'tm_amount') ? sum(rows, 'tm_amount') : null,
        withHours: new Set(rows.filter((r) => Number(r.engine_hours) > 0).map((r) => r.asset_id)).size,
        projects: byProject.filter((p) => p.jobsite !== 'No jobsite').length,
      }
    : null

  // ---------- downloads ----------
  const fileStem = ranFor ? `hours-by-project_${ranFor.from}_to_${ranFor.to}` : 'hours-by-project'

  function downloadSummary() {
    const columns = [
      { key: 'asset_number', label: 'Asset #' }, { key: 'machine', label: 'Machine' },
      { key: 'jobsite', label: 'Jobsite' }, { key: 'job_number', label: 'Job #' },
      { key: 'days', label: 'Days' }, { key: 'engine_hours', label: 'Engine hours' },
      { key: 'idle_hours', label: 'Idle hours' }, { key: 'hours_on_site', label: 'Hours on site' },
      { key: 'tm_amount', label: 'T&M amount' },
    ]
    const out = byMachine.flatMap(({ asset, rows: rs }) =>
      rs.map((r) => ({ ...r, asset_number: asset.asset_number, machine: machineName(asset) })))
    downloadCSV(`${fileStem}.csv`, toCSV(columns, out))
  }

  // one column per day, a Total row per machine then a row per jobsite (like the old export)
  async function downloadDaily() {
    setExporting(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('report_hours_daily', { p_assets: ranFor.ids, p_from: ranFor.from, p_to: ranFor.to })
    setExporting(false)
    if (err) return setError(err.message)
    const days = [...new Set((data || []).map((d) => d.date))].sort()
    const columns = [
      { key: 'machine', label: 'Machine' }, { key: 'jobsite', label: 'Jobsite' }, { key: 'job_number', label: 'Job #' },
      ...days.map((d) => ({ key: d, label: d })), { key: 'total', label: 'Total' },
    ]
    const out = []
    for (const { asset } of byMachine) {
      const mine = (data || []).filter((d) => d.asset_id === asset.id)
      if (!mine.length) continue
      const totalRow = { machine: machineLabel(asset), jobsite: 'Total', total: 0 }
      const sites = new Map()
      for (const d of mine) {
        totalRow[d.date] = Math.round(((totalRow[d.date] || 0) + Number(d.hours)) * 100) / 100
        totalRow.total += Number(d.hours)
        const s = sites.get(d.jobsite) || { machine: '', jobsite: d.jobsite, job_number: d.job_number || '', total: 0 }
        s[d.date] = Math.round(((s[d.date] || 0) + Number(d.hours)) * 100) / 100
        s.total += Number(d.hours)
        sites.set(d.jobsite, s)
      }
      totalRow.total = Math.round(totalRow.total * 100) / 100
      out.push(totalRow)
      for (const s of sites.values()) out.push({ ...s, total: Math.round(s.total * 100) / 100 })
    }
    downloadCSV(`${fileStem}_daily.csv`, toCSV(columns, out))
  }

  const stale = ranFor && (ranFor.from !== from || ranFor.to !== to || ranFor.ids.length !== selected.size ||
    ranFor.ids.some((id) => !selected.has(id)))

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-graphite-700 px-6 py-4">
        <Link to="/reports" className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-300">
          <ChevronLeft size={13} /> Reports
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-ink-100">Hours by project</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Engine hours for the machines you pick, split by the jobsite each machine was at.
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ---------- choices ---------- */}
        <aside className="flex w-full shrink-0 flex-col border-b border-graphite-700 bg-graphite-800/40 lg:w-80 lg:border-b-0 lg:border-r">
          <div className="space-y-3 border-b border-graphite-700 px-4 py-4">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-500">From</span>
                <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="input w-full" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-500">To</span>
                <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="input w-full" />
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ranges.map((r) => {
                const on = r.from === from && r.to === to
                return (
                  <button key={r.label} type="button" onClick={() => { setFrom(r.from); setTo(r.to) }}
                          className={`rounded px-2 py-1 text-xs ${on ? 'bg-amber-400/15 text-amber-400' : 'text-ink-300 hover:bg-graphite-700'}`}>
                    {r.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-ink-100">Assets</span>
              <span className="text-xs text-ink-500">{selected.size} selected</span>
            </div>
            <div className="relative mt-2">
              <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-500" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number, make, model, category or crew"
                     className="input w-full pl-7 text-xs" />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button type="button" onClick={() => addMany(shown)} className="rounded border border-graphite-600 px-2 py-0.5 text-xs text-ink-300 hover:bg-graphite-700">
                Add all shown
              </button>
              {groups.categories.map(([name]) => (
                <button key={`c-${name}`} type="button" onClick={() => addMany(pool.filter((a) => a.category?.name === name))}
                        className="rounded border border-graphite-700 px-2 py-0.5 text-xs text-ink-500 hover:bg-graphite-700 hover:text-ink-300">
                  + {name}
                </button>
              ))}
              {groups.crews.map(([name]) => (
                <button key={`w-${name}`} type="button" onClick={() => addMany(pool.filter((a) => a.crew?.name === name))}
                        className="rounded border border-graphite-700 px-2 py-0.5 text-xs text-ink-500 hover:bg-graphite-700 hover:text-ink-300">
                  + {name} crew
                </button>
              ))}
              {selected.size > 0 && (
                <button type="button" onClick={() => setSelected(new Set())} className="rounded px-2 py-0.5 text-xs text-ink-500 hover:text-rust-400">
                  Clear
                </button>
              )}
            </div>
            <ul className="mt-2 min-h-[12rem] flex-1 divide-y divide-graphite-800 overflow-y-auto rounded border border-graphite-800 lg:min-h-0">
              {assets === null && <li className="px-2.5 py-2 text-xs text-ink-500">Loading assets…</li>}
              {shown.map((a) => (
                <li key={a.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 px-2.5 py-1.5 text-sm hover:bg-graphite-800/60">
                    <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                    <span className="w-12 shrink-0 font-mono text-xs text-ink-300">{a.asset_number}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-100">{machineName(a) || '—'}</span>
                    {a.status === 'retired' && <span className="text-[11px] text-ink-500">retired</span>}
                  </label>
                </li>
              ))}
              {assets !== null && shown.length === 0 && <li className="px-2.5 py-2 text-xs text-ink-500">No assets match.</li>}
            </ul>
            <label className="mt-2 flex items-center gap-2 text-xs text-ink-500">
              <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
              Include retired machines
            </label>
          </div>

          <div className="border-t border-graphite-700 px-4 py-3">
            <button type="button" onClick={run} disabled={running}
                    className="flex w-full items-center justify-center gap-2 rounded bg-amber-400 px-3 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90 disabled:opacity-60">
              {running && <Loader2 size={14} className="animate-spin" />}
              {running ? 'Adding up hours…' : 'Show hours'}
            </button>
            {error && <p className="mt-2 text-sm text-rust-400">{error}</p>}
          </div>
        </aside>

        {/* ---------- results ---------- */}
        <section className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
          {!rows && (
            <div className="max-w-md text-sm text-ink-500">
              Pick the assets and dates on the left, then choose <span className="text-ink-300">Show hours</span>.
              Each day&rsquo;s engine hours go to the jobsite the machine was at most that day; days outside every
              jobsite boundary show as No jobsite.
            </div>
          )}

          {rows && totals && (
            <>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="text-sm text-ink-500">
                    {fmtDate(ranFor.from)} to {fmtDate(ranFor.to)}, {ranFor.ids.length} asset{ranFor.ids.length === 1 ? '' : 's'}
                    {stale && <span className="ml-2 text-amber-400">Choices changed: show hours again to update</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                    <div>
                      <span className="font-mono text-3xl font-semibold text-ink-100">{hrs(totals.engine)}</span>
                      <span className="ml-1.5 text-sm text-ink-500">engine hours</span>
                    </div>
                    <div className="text-sm text-ink-300">
                      {totals.projects} jobsite{totals.projects === 1 ? '' : 's'}, {totals.withHours} machine{totals.withHours === 1 ? '' : 's'} with hours
                    </div>
                    {totals.tm != null && <div className="text-sm text-ink-300">{money(totals.tm)} T&amp;M</div>}
                    {totals.onSite != null && <div className="text-sm text-ink-300">{hrs(totals.onSite)} h on site</div>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={downloadSummary}
                          className="flex items-center gap-1.5 rounded border border-graphite-600 px-2.5 py-1.5 text-xs text-ink-300 hover:bg-graphite-700">
                    <Download size={13} /> Download summary
                  </button>
                  <button type="button" onClick={downloadDaily} disabled={exporting}
                          className="flex items-center gap-1.5 rounded border border-graphite-600 px-2.5 py-1.5 text-xs text-ink-300 hover:bg-graphite-700 disabled:opacity-60">
                    {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download daily hours
                  </button>
                </div>
              </div>

              <div className="mt-5 inline-flex rounded border border-graphite-700 p-0.5 text-xs">
                {[['machine', 'By machine'], ['project', 'By jobsite']].map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setView(k)}
                          className={`rounded px-3 py-1 ${view === k ? 'bg-graphite-700 text-ink-100' : 'text-ink-500 hover:text-ink-300'}`}>
                    {label}
                  </button>
                ))}
              </div>

              {view === 'machine' ? <MachineTable groups={byMachine} /> : <ProjectTable projects={byProject} />}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function Th({ children, right }) {
  return <th className={`px-3 py-2 font-medium ${right ? 'text-right' : ''}`}>{children}</th>
}

function MachineTable({ groups }) {
  return (
    <div className="mt-3 overflow-x-auto rounded border border-graphite-700">
      <table className="w-full text-sm">
        <thead className="bg-graphite-900 text-left text-xs text-ink-500">
          <tr>
            <Th>Machine / jobsite</Th><Th right>Days</Th><Th right>Engine hours</Th><Th right>On site</Th><Th right>T&amp;M</Th>
          </tr>
        </thead>
        <tbody>
          {groups.map(({ asset, rows }) => (
            <MachineRows key={asset.id} asset={asset} rows={rows} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MachineRows({ asset, rows }) {
  const total = sum(rows, 'engine_hours')
  return (
    <>
      <tr className="border-t border-graphite-700 bg-graphite-800/50">
        <td className="px-3 py-2">
          <Link to={`/assets/${asset.id}`} className="text-ink-100 hover:text-amber-400">
            <span className="font-mono text-xs text-ink-300">{asset.asset_number}</span>
            <span className="ml-2 font-medium">{machineName(asset)}</span>
          </Link>
        </td>
        <td className="px-3 py-2 text-right font-mono text-ink-300">{rows.length ? sum(rows, 'days') : ''}</td>
        <td className="px-3 py-2 text-right font-mono font-medium text-ink-100">{rows.length ? hrs(total) : ''}</td>
        <td className="px-3 py-2 text-right font-mono text-ink-300">{anyValue(rows, 'hours_on_site') ? hrs(sum(rows, 'hours_on_site')) : ''}</td>
        <td className="px-3 py-2 text-right font-mono text-ink-300">{anyValue(rows, 'tm_amount') ? money(sum(rows, 'tm_amount')) : ''}</td>
      </tr>
      {rows.length === 0 && (
        <tr><td colSpan={5} className="px-3 py-1.5 pl-8 text-xs text-ink-500">No hours in this range</td></tr>
      )}
      {rows.map((r) => (
        <tr key={`${r.project_id || 'none'}-${r.jobsite}`} className="border-t border-graphite-800">
          <td className={`px-3 py-1.5 pl-8 ${r.jobsite === 'No jobsite' ? 'text-ink-500' : 'text-ink-100'}`}>
            {r.jobsite}
            {r.job_number && <span className="ml-1.5 font-mono text-xs text-ink-500">{r.job_number}</span>}
          </td>
          <td className="px-3 py-1.5 text-right font-mono text-ink-300">{r.days || ''}</td>
          <td className="px-3 py-1.5 text-right font-mono text-ink-100">{hrs(r.engine_hours)}</td>
          <td className="px-3 py-1.5 text-right font-mono text-ink-300">{r.hours_on_site != null ? hrs(r.hours_on_site) : ''}</td>
          <td className="px-3 py-1.5 text-right font-mono text-ink-300">{r.tm_amount != null ? money(r.tm_amount) : ''}</td>
        </tr>
      ))}
    </>
  )
}

function ProjectTable({ projects }) {
  return (
    <div className="mt-3 overflow-x-auto rounded border border-graphite-700">
      <table className="w-full text-sm">
        <thead className="bg-graphite-900 text-left text-xs text-ink-500">
          <tr>
            <Th>Jobsite</Th><Th right>Machines</Th><Th right>Engine hours</Th><Th right>On site</Th><Th right>T&amp;M</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-graphite-800">
          {projects.map((p) => (
            <tr key={`${p.jobsite}-${p.job_number || ''}`}>
              <td className={`px-3 py-2 ${p.jobsite === 'No jobsite' ? 'text-ink-500' : 'text-ink-100'}`}>
                {p.jobsite}
                {p.job_number && <span className="ml-1.5 font-mono text-xs text-ink-500">{p.job_number}</span>}
              </td>
              <td className="px-3 py-2 text-right font-mono text-ink-300">{p.machines.size}</td>
              <td className="px-3 py-2 text-right font-mono font-medium text-ink-100">{hrs(p.engine_hours)}</td>
              <td className="px-3 py-2 text-right font-mono text-ink-300">{p.hours_on_site != null ? hrs(p.hours_on_site) : ''}</td>
              <td className="px-3 py-2 text-right font-mono text-ink-300">{p.tm_amount != null ? money(p.tm_amount) : ''}</td>
            </tr>
          ))}
          {projects.length === 0 && (
            <tr><td colSpan={5} className="px-3 py-3 text-sm text-ink-500">No hours for these assets in this range.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
