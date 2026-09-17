const STATUS_STYLES = {
  active: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  down: 'bg-rust-500/15 text-rust-400 border-rust-500/30',
  maintenance: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  retired: 'bg-graphite-600/40 text-ink-500 border-graphite-500/40',
}

const STATUS_LABELS = {
  active: 'Active',
  down: 'Down',
  maintenance: 'In service',
  retired: 'Retired',
}

export default function StatusBadge({ status }) {
  const cls = STATUS_STYLES[status] || STATUS_STYLES.retired
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {STATUS_LABELS[status] || status}
    </span>
  )
}
