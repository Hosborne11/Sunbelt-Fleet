import { useMemo } from 'react'
import { iconFor } from '../lib/categoryIcons'

const STATUS_META = {
  active: { label: 'Active', color: 'bg-teal-400' },
  down: { label: 'Down', color: 'bg-rust-400' },
  maintenance: { label: 'In service', color: 'bg-amber-400' },
  retired: { label: 'Retired', color: 'bg-graphite-500' },
}

function Bar({ label, count, total, color, icon: Icon }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-ink-300">
          {Icon && <Icon size={14} strokeWidth={1.75} className="text-ink-500" />}
          {label}
        </span>
        <span className="font-mono text-ink-500">{count}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-graphite-700">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function DashboardView({ assets, categories, jobsites }) {
  const total = assets.length

  const byStatus = useMemo(() => {
    const counts = { active: 0, down: 0, maintenance: 0, retired: 0 }
    for (const a of assets) counts[a.status] = (counts[a.status] || 0) + 1
    return counts
  }, [assets])

  const byCategory = useMemo(() => {
    const counts = {}
    for (const a of assets) {
      const key = a.category_id || 'none'
      counts[key] = (counts[key] || 0) + 1
    }
    return categories
      .map((c) => ({ id: c.id, name: c.name, icon: c.icon, count: counts[c.id] || 0 }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count)
  }, [assets, categories])

  const byJobsite = useMemo(() => {
    const counts = {}
    let unassigned = 0
    for (const a of assets) {
      if (!a.jobsite_id) {
        unassigned += 1
        continue
      }
      counts[a.jobsite_id] = (counts[a.jobsite_id] || 0) + 1
    }
    const rows = jobsites
      .map((j) => ({ id: j.id, name: j.name, count: counts[j.id] || 0 }))
      .filter((j) => j.count > 0)
    if (unassigned > 0) rows.push({ id: 'unassigned', name: 'Unassigned / yard', count: unassigned })
    return rows.sort((a, b) => b.count - a.count)
  }, [assets, jobsites])

  if (total === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="text-ink-300">Add some assets to see fleet stats here.</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded border border-graphite-700 bg-graphite-800 p-4">
          <div className="text-2xl font-semibold text-ink-100">{total}</div>
          <div className="text-xs text-ink-500">Total assets</div>
        </div>
        {Object.entries(STATUS_META).map(([key, meta]) => (
          <div key={key} className="rounded border border-graphite-700 bg-graphite-800 p-4">
            <div className="flex items-center gap-1.5 text-2xl font-semibold text-ink-100">
              <span className={`h-2 w-2 rounded-full ${meta.color}`} />
              {byStatus[key] || 0}
            </div>
            <div className="text-xs text-ink-500">{meta.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div>
          <h3 className="mb-4 text-sm font-semibold text-ink-100">By category</h3>
          <div className="space-y-3">
            {byCategory.map((c) => (
              <Bar
                key={c.id}
                label={c.name}
                count={c.count}
                total={total}
                color="bg-amber-400"
                icon={iconFor(c.icon)}
              />
            ))}
            {byCategory.length === 0 && (
              <p className="text-sm text-ink-500">No categorized assets yet.</p>
            )}
          </div>
        </div>

        <div>
          <h3 className="mb-4 text-sm font-semibold text-ink-100">By jobsite</h3>
          <div className="space-y-3">
            {byJobsite.map((j) => (
              <Bar key={j.id} label={j.name} count={j.count} total={total} color="bg-teal-400" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
