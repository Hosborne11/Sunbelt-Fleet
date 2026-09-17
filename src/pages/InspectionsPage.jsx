import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, CheckCircle2, XCircle, AlertCircle, ClipboardCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import InspectionDrawer from '../components/InspectionDrawer'

const TABS = ['All', 'Failed', 'Needs attention']

const RESULT_STYLES = {
  pass: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  fail: 'bg-rust-500/15 text-rust-400 border-rust-500/30',
  needs_attention: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
}

function Badge({ text, cls }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {text.replace('_', ' ')}
    </span>
  )
}

export default function InspectionsPage() {
  const [inspections, setInspections] = useState([])
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('All')
  const [search, setSearch] = useState('')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingInspection, setEditingInspection] = useState(null)

  async function loadAll() {
    setLoading(true)
    setError(null)
    const [inspRes, assetsRes] = await Promise.all([
      supabase
        .from('inspections')
        .select('*, asset:assets(id,asset_number)')
        .order('inspected_at', { ascending: false }),
      supabase.from('assets').select('id, asset_number').order('asset_number'),
    ])
    if (inspRes.error) setError(inspRes.error.message)
    setInspections(inspRes.data || [])
    setAssets(assetsRes.data || [])
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
  }, [])

  const counts = useMemo(() => {
    return {
      pass: inspections.filter((i) => i.result === 'pass').length,
      fail: inspections.filter((i) => i.result === 'fail').length,
      needsAttention: inspections.filter((i) => i.result === 'needs_attention').length,
    }
  }, [inspections])

  const filtered = useMemo(() => {
    return inspections.filter((i) => {
      if (tab === 'Failed' && i.result !== 'fail') return false
      if (tab === 'Needs attention' && i.result !== 'needs_attention') return false
      if (search) {
        const q = search.toLowerCase()
        const hay = [i.asset?.asset_number, i.inspector, i.inspection_type]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [inspections, tab, search])

  function openAdd() {
    setEditingInspection(null)
    setDrawerOpen(true)
  }
  function openEdit(i) {
    setEditingInspection(i)
    setDrawerOpen(true)
  }
  function closeDrawer() {
    setDrawerOpen(false)
    setEditingInspection(null)
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
            <h1 className="text-xl font-semibold text-ink-100">Inspections</h1>
            <p className="mt-0.5 text-sm text-ink-500">
              {loading ? 'Loading…' : `${filtered.length} of ${inspections.length} inspections`}
            </p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
          >
            <Plus size={16} /> Log inspection
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <SummaryCard icon={CheckCircle2} label="Passed" value={counts.pass} />
          <SummaryCard icon={XCircle} label="Failed" value={counts.fail} accent="rust" />
          <SummaryCard icon={AlertCircle} label="Needs attention" value={counts.needsAttention} accent="amber" />
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
              placeholder="Search asset, inspector, type…"
              className="w-64 rounded border border-graphite-600 bg-graphite-900 py-1.5 pl-8 pr-3 text-sm text-ink-100 placeholder:text-ink-500 outline-none focus:border-amber-400/60"
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-4">
        {error && (
          <div className="mb-4 rounded border border-rust-500/30 bg-rust-500/10 px-4 py-3 text-sm text-rust-400">
            {error.includes('relation') || error.includes('does not exist')
              ? "Couldn't find the inspections table yet — run supabase/migrations/005_inspections.sql in your Supabase project's SQL editor, then reload."
              : error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded border border-dashed border-graphite-600 py-16 text-center">
            <ClipboardCheck size={28} className="mb-2 text-ink-500" />
            <p className="text-ink-300">
              {inspections.length === 0
                ? 'No inspections logged yet.'
                : 'No inspections match this view.'}
            </p>
            {inspections.length === 0 && (
              <button
                onClick={openAdd}
                className="mt-3 rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
              >
                Log your first inspection
              </button>
            )}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="overflow-x-auto rounded border border-graphite-800">
            <table className="w-full min-w-[720px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-32" />
                <col className="w-24" />
                <col className="w-36" />
                <col className="w-40" />
                <col className="w-28" />
              </colgroup>
              <thead>
                <tr className="border-b border-graphite-700 bg-graphite-800/60 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="py-2 pl-3 pr-3 font-medium">Asset</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">Result</th>
                  <th className="py-2 pr-3 font-medium">Inspector</th>
                  <th className="py-2 pr-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr
                    key={i.id}
                    onClick={() => openEdit(i)}
                    className="cursor-pointer border-b border-graphite-800 hover:bg-graphite-800/60"
                  >
                    <td className="truncate py-2.5 pl-3 pr-3 font-mono text-ink-100">
                      {i.asset_id ? (
                        <Link
                          to={`/assets/${i.asset_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-amber-400 hover:underline"
                        >
                          {i.asset?.asset_number || '—'}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2.5 pr-3 uppercase text-ink-300">{i.inspection_type}</td>
                    <td className="py-2.5 pr-3">
                      <Badge text={i.result} cls={RESULT_STYLES[i.result]} />
                    </td>
                    <td className="truncate py-2.5 pr-3 text-ink-300">{i.inspector || '—'}</td>
                    <td className="py-2.5 pr-3 font-mono text-ink-500">{i.inspected_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawerOpen && (
        <InspectionDrawer
          inspection={editingInspection}
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
