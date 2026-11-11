import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ChevronLeft, Download, Loader2, Save, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { toCSV, downloadCSV } from '../lib/reports'

// Custom reports: any date range, any machines, the columns you want, grouped up to two levels.
// Data comes from report_daily_rows (one row per machine per day); grouping and totals happen here.

// ---------- dates ----------
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const RANGES = {
  this_week: { label: 'This week', get: (t) => { const s = addDays(t, -((t.getDay() + 6) % 7)); return [s, t] } },
  last_week: { label: 'Last week', get: (t) => { const s = addDays(t, -((t.getDay() + 6) % 7) - 7); return [s, addDays(s, 6)] } },
  this_month: { label: 'This month', get: (t) => [new Date(t.getFullYear(), t.getMonth(), 1), t] },
  last_month: { label: 'Last month', get: (t) => [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0)] },
  last_30: { label: 'Last 30 days', get: (t) => [addDays(t, -29), t] },
  last_90: { label: 'Last 90 days', get: (t) => [addDays(t, -89), t] },
  ytd: { label: 'Year to date', get: (t) => [new Date(t.getFullYear(), 0, 1), t] },
  last_year: { label: 'Last year', get: (t) => [new Date(t.getFullYear() - 1, 0, 1), new Date(t.getFullYear() - 1, 11, 31)] },
}
const rangeDates = (key) => RANGES[key].get(new Date()).map(iso)
const weekOf = (d) => iso(addDays(new Date(`${d}T12:00:00`), -((new Date(`${d}T12:00:00`).getDay() + 6) % 7)))
const fmtDay = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

// ---------- grouping ----------
const GROUPS = {
  machine: { label: 'Machine', key: (r) => r.asset_id, show: (r) => [r.asset_number, r.machine].filter(Boolean).join(' '), sort: (r) => r.asset_number },
  day: { label: 'Day', key: (r) => r.date, show: (r) => fmtDay(r.date), sort: (r) => r.date },
  week: { label: 'Week', key: (r) => weekOf(r.date), show: (r) => `Week of ${fmtDay(weekOf(r.date))}`, sort: (r) => weekOf(r.date) },
  month: { label: 'Month', key: (r) => r.date.slice(0, 7), show: (r) => new Date(`${r.date.slice(0, 7)}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), sort: (r) => r.date.slice(0, 7) },
  jobsite: { label: 'Jobsite', key: (r) => r.jobsite, show: (r) => [r.jobsite, r.job_number].filter(Boolean).join(' '), sort: (r) => (r.jobsite === 'No jobsite' ? '~' : r.jobsite) },
  crew: { label: 'Crew', key: (r) => r.crew || 'No crew', show: (r) => (r.crew ? `${r.crew} crew` : 'No crew'), sort: (r) => r.crew || '~' },
  category: { label: 'Category', key: (r) => r.category || 'Uncategorized', show: (r) => r.category || 'Uncategorized', sort: (r) => r.category || '~' },
}

// ---------- columns ----------
const n = (v) => (v == null ? 0 : Number(v))
const has = (rows, k) => rows.some((r) => r[k] != null)
const MEASURES = {
  hours: { label: 'Engine hours', calc: (rs) => rs.reduce((t, r) => t + n(r.hours), 0), fmt: 'h' },
  idle_hours: { label: 'Idle hours', calc: (rs) => (has(rs, 'idle_hours') ? rs.reduce((t, r) => t + n(r.idle_hours), 0) : null), fmt: 'h' },
  idle_pct: { label: 'Idle %', calc: (rs) => { const h = rs.reduce((t, r) => t + n(r.hours), 0); return has(rs, 'idle_hours') && h > 0 ? (100 * rs.reduce((t, r) => t + n(r.idle_hours), 0)) / h : null }, fmt: 'pct' },
  days_worked: { label: 'Days worked', calc: (rs) => new Set(rs.filter((r) => n(r.hours) > 0).map((r) => `${r.asset_id}|${r.date}`)).size, fmt: 'int' },
  machines: { label: 'Machines', calc: (rs) => new Set(rs.map((r) => r.asset_id)).size, fmt: 'int' },
  fuel_gal: { label: 'Fuel (gal)', calc: (rs) => (has(rs, 'fuel_gal') ? rs.reduce((t, r) => t + n(r.fuel_gal), 0) : null), fmt: 'h' },
  loads: { label: 'Loads', calc: (rs) => (has(rs, 'loads') ? rs.reduce((t, r) => t + n(r.loads), 0) : null), fmt: 'int' },
  tons: { label: 'Tons', calc: (rs) => (has(rs, 'tons') ? rs.reduce((t, r) => t + n(r.tons), 0) : null), fmt: 'h' },
  tons_per_load: { label: 'Tons / load', calc: (rs) => { const l = rs.reduce((t, r) => t + n(r.loads), 0); return l > 0 ? rs.reduce((t, r) => t + n(r.tons), 0) / l : null }, fmt: 'h' },
  site_hours: { label: 'Hours on site', calc: (rs) => (has(rs, 'site_hours') ? rs.reduce((t, r) => t + n(r.site_hours), 0) : null), fmt: 'h' },
  tm_amount: { label: 'T&M $', calc: (rs) => (has(rs, 'tm_amount') ? rs.reduce((t, r) => t + n(r.tm_amount), 0) : null), fmt: 'money' },
}
const show = (v, fmt) => {
  if (v == null) return '—'
  if (fmt === 'money') return Number(v).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  if (fmt === 'pct') return `${Math.round(v)}%`
  if (fmt === 'int') return Number(v).toLocaleString()
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}
const csvValue = (v, fmt) => (v == null ? '' : fmt === 'int' ? Math.round(v) : fmt === 'pct' ? Math.round(v) : Math.round(v * 100) / 100)

const DEFAULT = {
  range: 'last_month', from: '', to: '',
  groups: ['machine', 'jobsite'],
  measures: ['hours', 'days_worked', 'idle_pct', 'tm_amount'],
  filters: { assets: [], categories: [], crews: [], jobsites: [] },
}

export default function CustomReportPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [def, setDef] = useState(DEFAULT)
  const [name, setName] = useState('')
  const [savedId, setSavedId] = useState(null)
  const [assets, setAssets] = useState([])
  const [rows, setRows] = useState(null)
  const [ranLabel, setRanLabel] = useState('')
  const [sort, setSort] = useState({ col: null, dir: 'asc' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    supabase.from('assets').select('id, asset_number, make, model, status, category:equipment_categories(name), crew:crews(name)')
      .not('telematics_asset_id', 'is', null)
      .then(({ data }) => setAssets((data || []).sort((a, b) => String(a.asset_number).localeCompare(String(b.asset_number), undefined, { numeric: true }))))
  }, [])

  // open a saved report
  useEffect(() => {
    if (!id) return
    supabase.from('saved_reports').select('*').eq('id', id).maybeSingle().then(({ data, error: err }) => {
      if (err || !data) return setError(err?.message || 'That saved report no longer exists.')
      setDef({ ...DEFAULT, ...data.definition, filters: { ...DEFAULT.filters, ...(data.definition?.filters || {}) } })
      setName(data.name)
      setSavedId(data.id)
    })
  }, [id])

  const set = (patch) => setDef((d) => ({ ...d, ...patch }))
  const setFilter = (k, v) => setDef((d) => ({ ...d, filters: { ...d.filters, [k]: v } }))
  const [from, to] = def.range === 'custom' ? [def.from, def.to] : rangeDates(def.range)

  const categories = useMemo(() => [...new Set(assets.map((a) => a.category?.name).filter(Boolean))].sort(), [assets])
  const crews = useMemo(() => [...new Set(assets.map((a) => a.crew?.name).filter(Boolean))].sort(), [assets])
  const jobsites = useMemo(() => [...new Set((rows || []).map((r) => r.jobsite))].sort(), [rows])

  async function run() {
    setError(null)
    setMsg(null)
    if (!from || !to || from > to) return setError('Pick a start date on or before the end date.')
    if (!def.measures.length) return setError('Pick at least one column.')
    setBusy(true)
    const ids = def.filters.assets.length ? def.filters.assets : null
    const { data, error: err } = await supabase.rpc('report_daily_rows', { p_from: from, p_to: to, p_assets: ids })
    setBusy(false)
    if (err) return setError(err.message)
    setRows(data || [])
    setRanLabel(`${fmtDay(from)} to ${fmtDay(to)}`)
  }

  // filter + group
  const filtered = useMemo(() => (rows || []).filter((r) =>
    (!def.filters.categories.length || def.filters.categories.includes(r.category || 'Uncategorized')) &&
    (!def.filters.crews.length || def.filters.crews.includes(r.crew || 'No crew')) &&
    (!def.filters.jobsites.length || def.filters.jobsites.includes(r.jobsite))), [rows, def.filters])

  const table = useMemo(() => {
    const gs = def.groups.filter(Boolean)
    const groups = new Map()
    for (const r of filtered) {
      const key = gs.map((g) => GROUPS[g].key(r)).join('||')
      const e = groups.get(key) || { sample: r, rows: [] }
      e.rows.push(r)
      groups.set(key, e)
    }
    let out = [...groups.values()].map((e) => ({
      labels: gs.map((g) => GROUPS[g].show(e.sample)),
      sortKeys: gs.map((g) => GROUPS[g].sort(e.sample)),
      values: def.measures.map((m) => MEASURES[m].calc(e.rows)),
    }))
    if (!gs.length) out = filtered.map((r) => ({ labels: [], sortKeys: [], values: def.measures.map((m) => MEASURES[m].calc([r])), detail: r }))
    out.sort((a, b) => {
      if (sort.col != null) {
        const va = a.values[sort.col] ?? -Infinity
        const vb = b.values[sort.col] ?? -Infinity
        return sort.dir === 'asc' ? va - vb : vb - va
      }
      for (let i = 0; i < a.sortKeys.length; i++) {
        const c = String(a.sortKeys[i]).localeCompare(String(b.sortKeys[i]), undefined, { numeric: true })
        if (c) return c
      }
      return 0
    })
    return { gs, rows: out, totals: def.measures.map((m) => MEASURES[m].calc(filtered)) }
  }, [filtered, def.groups, def.measures, sort])

  const detailCols = ['Date', 'Asset #', 'Machine', 'Jobsite']
  function exportCSV() {
    const groupCols = table.gs.length ? table.gs.map((g) => GROUPS[g].label) : detailCols
    const columns = [...groupCols.map((label, i) => ({ key: `g${i}`, label })),
                     ...def.measures.map((m, i) => ({ key: `m${i}`, label: MEASURES[m].label }))]
    const data = table.rows.map((r) => {
      const o = {}
      const labels = r.detail ? [r.detail.date, r.detail.asset_number, r.detail.machine, r.detail.jobsite] : r.labels
      labels.forEach((l, i) => { o[`g${i}`] = l })
      r.values.forEach((v, i) => { o[`m${i}`] = csvValue(v, MEASURES[def.measures[i]].fmt) })
      return o
    })
    const total = { g0: 'Total' }
    table.totals.forEach((v, i) => { total[`m${i}`] = csvValue(v, MEASURES[def.measures[i]].fmt) })
    const file = (name || 'custom-report').replace(/[^\w-]+/g, '-').toLowerCase()
    downloadCSV(`${file}_${from}_to_${to}.csv`, toCSV(columns, [...data, total]))
  }

  async function save(asNew) {
    setError(null)
    const nm = name.trim() || window.prompt('Name this report:', '')?.trim()
    if (!nm) return
    setName(nm)
    const { data: auth } = await supabase.auth.getUser()
    const row = { name: nm, definition: def, created_by: auth?.user?.email || null }
    const res = savedId && !asNew
      ? await supabase.from('saved_reports').update(row).eq('id', savedId).select('id').single()
      : await supabase.from('saved_reports').insert(row).select('id').single()
    if (res.error) return setError(res.error.message)
    setSavedId(res.data.id)
    setMsg('Saved. It’s listed under Reports, and rolling dates move forward each time it’s run.')
    if (!id || asNew) navigate(`/reports/custom/${res.data.id}`, { replace: true })
  }

  async function remove() {
    if (!savedId || !window.confirm(`Delete the saved report “${name}”?`)) return
    await supabase.from('saved_reports').delete().eq('id', savedId)
    navigate('/reports/custom', { replace: true })
    setSavedId(null)
    setName('')
  }

  const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-graphite-700 px-6 py-4">
        <div>
          <Link to="/reports" className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-300"><ChevronLeft size={13} /> Reports</Link>
          <h1 className="mt-1 text-xl font-semibold text-ink-100">{name || 'Custom report'}</h1>
          <p className="mt-0.5 text-sm text-ink-500">Pick the dates, machines and columns, then how to group them.</p>
        </div>
        <div className="flex items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Report name" className="input w-48 text-sm" />
          <button type="button" onClick={() => save(false)} className="flex items-center gap-1.5 rounded border border-graphite-600 px-2.5 py-1.5 text-xs text-ink-300 hover:bg-graphite-700">
            <Save size={13} /> {savedId ? 'Save' : 'Save report'}
          </button>
          {savedId && (
            <>
              <button type="button" onClick={() => save(true)} className="rounded px-2 py-1.5 text-xs text-ink-500 hover:text-ink-300">Save as new</button>
              <button type="button" onClick={remove} title="Delete this saved report" className="rounded p-1.5 text-ink-500 hover:text-rust-400"><Trash2 size={14} /></button>
            </>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="w-full shrink-0 space-y-5 overflow-y-auto border-b border-graphite-700 bg-graphite-800/40 px-4 py-4 lg:w-80 lg:border-b-0 lg:border-r">
          <Section title="Dates">
            <select value={def.range} onChange={(e) => set({ range: e.target.value })} className="input w-full text-sm">
              {Object.entries(RANGES).map(([k, r]) => <option key={k} value={k}>{r.label} (rolling)</option>)}
              <option value="custom">Fixed dates</option>
            </select>
            {def.range === 'custom' ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input type="date" value={def.from} onChange={(e) => set({ from: e.target.value })} className="input w-full" />
                <input type="date" value={def.to} onChange={(e) => set({ to: e.target.value })} className="input w-full" />
              </div>
            ) : <p className="mt-1 text-xs text-ink-500">{fmtDay(from)} to {fmtDay(to)}</p>}
          </Section>

          <Section title="Group by">
            {[0, 1].map((i) => (
              <select key={i} value={def.groups[i] || ''} className="input mb-2 w-full text-sm"
                      onChange={(e) => { const g = [...def.groups]; g[i] = e.target.value; set({ groups: g.filter((x, j) => x || j === 0).slice(0, 2) }); setSort({ col: null, dir: 'asc' }) }}>
                <option value="">{i === 0 ? 'No grouping (one row per machine per day)' : 'Then by: nothing'}</option>
                {Object.entries(GROUPS).filter(([k]) => k !== def.groups[1 - i]).map(([k, g]) => <option key={k} value={k}>{i === 0 ? '' : 'Then by '}{g.label}</option>)}
              </select>
            ))}
          </Section>

          <Section title="Columns">
            <div className="grid grid-cols-2 gap-x-2 gap-y-1">
              {Object.entries(MEASURES).map(([k, m]) => (
                <label key={k} className="flex items-center gap-1.5 text-sm text-ink-300">
                  <input type="checkbox" checked={def.measures.includes(k)}
                         onChange={() => set({ measures: Object.keys(MEASURES).filter((x) => (x === k ? !def.measures.includes(k) : def.measures.includes(x))) })} />
                  {m.label}
                </label>
              ))}
            </div>
          </Section>

          <Section title="Machines">
            <Chips label="Category" options={categories} value={def.filters.categories} onChange={(v) => setFilter('categories', v)} toggle={toggle} />
            <Chips label="Crew" options={crews} value={def.filters.crews} onChange={(v) => setFilter('crews', v)} toggle={toggle} />
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-ink-500">
                Specific machines {def.filters.assets.length ? `(${def.filters.assets.length} picked)` : '(all)'}
              </summary>
              <ul className="mt-1 max-h-56 divide-y divide-graphite-800 overflow-y-auto rounded border border-graphite-800">
                {assets.filter((a) => a.status !== 'retired').map((a) => (
                  <li key={a.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-graphite-800/60">
                      <input type="checkbox" checked={def.filters.assets.includes(a.id)} onChange={() => setFilter('assets', toggle(def.filters.assets, a.id))} />
                      <span className="w-10 font-mono text-ink-300">{a.asset_number}</span>
                      <span className="truncate text-ink-100">{[a.make, a.model].filter(Boolean).join(' ')}</span>
                    </label>
                  </li>
                ))}
              </ul>
              {def.filters.assets.length > 0 && <button type="button" onClick={() => setFilter('assets', [])} className="mt-1 text-xs text-ink-500 hover:text-ink-300">Clear</button>}
            </details>
          </Section>

          {jobsites.length > 0 && (
            <Section title="Jobsites">
              <Chips options={jobsites} value={def.filters.jobsites} onChange={(v) => setFilter('jobsites', v)} toggle={toggle} />
            </Section>
          )}

          <button type="button" onClick={run} disabled={busy}
                  className="flex w-full items-center justify-center gap-2 rounded bg-amber-400 px-3 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90 disabled:opacity-60">
            {busy && <Loader2 size={14} className="animate-spin" />}{busy ? 'Running…' : 'Run report'}
          </button>
          {error && <p className="text-sm text-rust-400">{error}</p>}
          {msg && <p className="text-sm text-teal-400">{msg}</p>}
        </aside>

        <section className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
          {!rows && <p className="max-w-md text-sm text-ink-500">Set up the report on the left and choose <span className="text-ink-300">Run report</span>. Category, crew and jobsite filters apply right away once it has run.</p>}
          {rows && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-ink-500">{ranLabel} · {table.rows.length.toLocaleString()} row{table.rows.length === 1 ? '' : 's'}</p>
                <button type="button" onClick={exportCSV} disabled={!table.rows.length}
                        className="flex items-center gap-1.5 rounded border border-graphite-600 px-2.5 py-1.5 text-xs text-ink-300 hover:bg-graphite-700 disabled:opacity-50">
                  <Download size={13} /> Export CSV
                </button>
              </div>
              <div className="mt-3 overflow-x-auto rounded border border-graphite-700">
                <table className="w-full text-sm">
                  <thead className="bg-graphite-900 text-left text-xs text-ink-500">
                    <tr>
                      {(table.gs.length ? table.gs.map((g) => GROUPS[g].label) : detailCols).map((l) => <th key={l} className="px-3 py-2 font-medium">{l}</th>)}
                      {def.measures.map((m, i) => (
                        <th key={m} className="px-3 py-2 text-right font-medium">
                          <button type="button" className="inline-flex items-center gap-1 hover:text-ink-300"
                                  onClick={() => setSort((s) => ({ col: i, dir: s.col === i && s.dir === 'desc' ? 'asc' : 'desc' }))}>
                            {MEASURES[m].label}
                            {sort.col === i && (sort.dir === 'desc' ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-graphite-800">
                    {table.rows.slice(0, 2000).map((r, i) => (
                      <tr key={i}>
                        {(r.detail ? [fmtDay(r.detail.date), r.detail.asset_number, r.detail.machine, r.detail.jobsite] : r.labels).map((l, j) => (
                          <td key={j} className={`px-3 py-1.5 ${j === 0 ? 'text-ink-100' : 'text-ink-300'}`}>{l}</td>
                        ))}
                        {r.values.map((v, j) => <td key={j} className="px-3 py-1.5 text-right font-mono text-ink-100">{show(v, MEASURES[def.measures[j]].fmt)}</td>)}
                      </tr>
                    ))}
                    {table.rows.length === 0 && <tr><td colSpan={9} className="px-3 py-3 text-ink-500">Nothing matches these choices.</td></tr>}
                  </tbody>
                  {table.rows.length > 0 && (
                    <tfoot className="border-t border-graphite-600 bg-graphite-900/60">
                      <tr>
                        <td className="px-3 py-2 font-medium text-ink-100" colSpan={table.gs.length || detailCols.length}>Total</td>
                        {table.totals.map((v, j) => <td key={j} className="px-3 py-2 text-right font-mono font-medium text-ink-100">{show(v, MEASURES[def.measures[j]].fmt)}</td>)}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              {table.rows.length > 2000 && <p className="mt-2 text-xs text-ink-500">Showing the first 2,000 rows. Export CSV includes all {table.rows.length.toLocaleString()}.</p>}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-ink-100">{title}</div>
      {children}
    </div>
  )
}

function Chips({ label, options, value, onChange, toggle }) {
  if (!options.length) return null
  return (
    <div className="mb-2">
      {label && <div className="mb-1 text-xs text-ink-500">{label} {value.length ? '' : '(all)'}</div>}
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button key={o} type="button" onClick={() => onChange(toggle(value, o))}
                  className={`rounded px-2 py-0.5 text-xs ${value.includes(o) ? 'bg-amber-400/15 text-amber-400' : 'border border-graphite-700 text-ink-500 hover:text-ink-300'}`}>
            {o}
          </button>
        ))}
      </div>
    </div>
  )
}
