import { useEffect, useMemo, useState } from 'react'
import { Download, FileBarChart, Loader2 } from 'lucide-react'
import { REPORTS, reportsByCategory, toCSV, downloadCSV } from '../lib/reports'

export default function ReportsPage() {
  const categories = useMemo(() => reportsByCategory(), [])
  const [selectedId, setSelectedId] = useState(REPORTS[0].id)
  const selected = REPORTS.find((r) => r.id === selectedId)

  const [filters, setFilters] = useState({})
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const defaults = {}
    for (const f of selected.filters || []) defaults[f.key] = f.default
    setFilters(defaults)
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function runReport() {
    setLoading(true)
    setError(null)
    try {
      const data = await selected.fetch(filters)
      setResult(data)
    } catch (err) {
      setError(err.message || String(err))
      setResult(null)
    }
    setLoading(false)
  }

  useEffect(() => {
    runReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, filters])

  function handleExport() {
    if (!result) return
    const allRows = result.rows || result.groups?.flatMap((g) => g.rows) || []
    const csv = toCSV(result.columns, allRows)
    downloadCSV(`${selected.id}.csv`, csv)
  }

  const totalRows = result ? (result.rows || result.groups?.flatMap((g) => g.rows) || []).length : 0

  return (
    <div className="flex h-full">
      <aside className="w-64 shrink-0 overflow-y-auto border-r border-graphite-700 bg-graphite-800/40 px-3 py-4">
        {categories.map(([category, reports]) => (
          <div key={category} className="mb-4">
            <div className="px-2 pb-1.5 font-mono text-[11px] uppercase tracking-wide text-ink-500">
              {category}
            </div>
            <div className="space-y-0.5">
              {reports.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={`block w-full rounded px-2 py-1.5 text-left text-sm transition-colors ${
                    r.id === selectedId
                      ? 'bg-amber-400/10 text-amber-400'
                      : 'text-ink-300 hover:bg-graphite-700 hover:text-ink-100'
                  }`}
                >
                  {r.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="border-b border-graphite-700 px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-ink-100">{selected.name}</h1>
              <p className="mt-0.5 text-sm text-ink-500">{selected.description}</p>
            </div>
            <button
              onClick={handleExport}
              disabled={!result || totalRows === 0}
              className="flex items-center gap-1.5 rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90 disabled:opacity-40"
            >
              <Download size={16} /> Export CSV
            </button>
          </div>

          {selected.filters && selected.filters.length > 0 && (
            <div className="mt-4 flex items-center gap-3">
              {selected.filters.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm text-ink-300">
                  {f.label}
                  <input
                    type={f.type}
                    value={filters[f.key] ?? f.default}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, [f.key]: Number(e.target.value) }))
                    }
                    className="input w-20 font-mono"
                  />
                </label>
              ))}
            </div>
          )}
        </header>

        <div className="flex-1 overflow-auto px-6 py-4">
          {loading && (
            <div className="flex items-center gap-2 py-8 text-ink-500">
              <Loader2 size={16} className="animate-spin" /> Running report…
            </div>
          )}

          {error && (
            <div className="mb-4 rounded border border-rust-500/30 bg-rust-500/10 px-4 py-3 text-sm text-rust-400">
              {error}
            </div>
          )}

          {!loading && !error && result && totalRows === 0 && (
            <div className="flex flex-col items-center justify-center rounded border border-dashed border-graphite-600 py-16 text-center">
              <FileBarChart size={28} className="mb-2 text-ink-500" />
              <p className="text-ink-300">No rows match this report right now.</p>
            </div>
          )}

          {!loading && !error && result && totalRows > 0 && result.rows && (
            <ReportTable columns={result.columns} rows={result.rows} />
          )}

          {!loading && !error && result && totalRows > 0 && result.groups && (
            <div className="space-y-6">
              {result.groups.map((g) => (
                <div key={g.label}>
                  <h3 className="mb-2 text-sm font-semibold text-ink-100">
                    {g.label}{' '}
                    <span className="font-normal text-ink-500">({g.rows.length})</span>
                  </h3>
                  <ReportTable columns={result.columns} rows={g.rows} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ReportTable({ columns, rows }) {
  return (
    <div className="overflow-x-auto rounded border border-graphite-800">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-graphite-700 bg-graphite-800/60 text-left text-xs uppercase tracking-wide text-ink-500">
            {columns.map((c) => (
              <th key={c.key} className="whitespace-nowrap py-2 px-3 font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-graphite-800">
              {columns.map((c) => (
                <td key={c.key} className="whitespace-nowrap py-2 px-3 text-ink-300">
                  {row[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
