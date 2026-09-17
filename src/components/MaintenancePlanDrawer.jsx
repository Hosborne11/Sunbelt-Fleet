import { useEffect, useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

const EMPTY = {
  asset_id: '',
  name: '',
  interval_hours: '',
  interval_days: '',
  last_service_hours: '',
  last_service_date: '',
  active: true,
  notes: '',
}

export default function MaintenancePlanDrawer({
  plan,
  assets,
  defaultAssetId,
  onClose,
  onSaved,
  onDeleted,
}) {
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (plan) {
      setForm({
        ...EMPTY,
        ...plan,
        asset_id: plan.asset_id || '',
        interval_hours: plan.interval_hours ?? '',
        interval_days: plan.interval_days ?? '',
        last_service_hours: plan.last_service_hours ?? '',
        last_service_date: plan.last_service_date || '',
        notes: plan.notes || '',
      })
    } else {
      setForm({ ...EMPTY, asset_id: defaultAssetId || '' })
    }
  }, [plan, defaultAssetId])

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.asset_id) {
      setError('Asset is required.')
      return
    }
    if (!form.name.trim()) {
      setError('Name is required.')
      return
    }
    if (!form.interval_hours && !form.interval_days) {
      setError('Set an hour interval, a day interval, or both.')
      return
    }
    setSaving(true)
    setError(null)

    const payload = {
      asset_id: form.asset_id,
      name: form.name.trim(),
      interval_hours: form.interval_hours !== '' ? Number(form.interval_hours) : null,
      interval_days: form.interval_days !== '' ? Number(form.interval_days) : null,
      last_service_hours: form.last_service_hours !== '' ? Number(form.last_service_hours) : null,
      last_service_date: form.last_service_date || null,
      active: form.active,
      notes: form.notes.trim() || null,
    }

    const query = plan
      ? supabase.from('maintenance_plans').update(payload).eq('id', plan.id)
      : supabase.from('maintenance_plans').insert(payload)

    const { error: err } = await query
    setSaving(false)

    if (err) {
      setError(err.message)
      return
    }
    onSaved()
  }

  async function handleDelete() {
    if (!plan) return
    if (!window.confirm(`Delete "${plan.name}"? This can't be undone.`)) return
    setSaving(true)
    const { error: err } = await supabase.from('maintenance_plans').delete().eq('id', plan.id)
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    onDeleted()
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-graphite-700 bg-graphite-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-graphite-700 px-5 py-4">
          <h2 className="text-base font-semibold text-ink-100">
            {plan ? 'Edit maintenance plan' : 'New maintenance plan'}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-ink-500 hover:bg-graphite-700 hover:text-ink-100"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <Field label="Asset" required>
            <select
              value={form.asset_id}
              onChange={(e) => set('asset_id', e.target.value)}
              className="input"
            >
              <option value="">—</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.asset_number}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Plan name" required>
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className="input"
              placeholder="e.g. 500 Hour Service"
            />
          </Field>

          <p className="text-xs text-ink-500">
            Set an hour interval, a day interval, or both — whichever comes due first will show as
            due.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Interval (hours)">
              <input
                type="number"
                value={form.interval_hours}
                onChange={(e) => set('interval_hours', e.target.value)}
                className="input font-mono"
                placeholder="e.g. 500"
              />
            </Field>
            <Field label="Interval (days)">
              <input
                type="number"
                value={form.interval_days}
                onChange={(e) => set('interval_days', e.target.value)}
                className="input font-mono"
                placeholder="e.g. 90"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Last service — hours">
              <input
                type="number"
                value={form.last_service_hours}
                onChange={(e) => set('last_service_hours', e.target.value)}
                className="input font-mono"
              />
            </Field>
            <Field label="Last service — date">
              <input
                type="date"
                value={form.last_service_date}
                onChange={(e) => set('last_service_date', e.target.value)}
                className="input"
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-300">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set('active', e.target.checked)}
              className="h-4 w-4 rounded border-graphite-600 bg-graphite-900"
            />
            Active
          </label>

          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              className="input min-h-[72px] resize-y"
            />
          </Field>

          {error && <p className="text-sm text-rust-400">{error}</p>}

          <div className="flex items-center justify-between pt-2">
            {plan ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="flex items-center gap-1.5 rounded px-3 py-2 text-sm text-rust-400 hover:bg-rust-500/10"
              >
                <Trash2 size={15} /> Delete
              </button>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-amber-400 px-4 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90 disabled:opacity-60"
            >
              {saving ? 'Saving…' : plan ? 'Save changes' : 'Create plan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-500">
        {label}
        {required && <span className="text-rust-400"> *</span>}
      </span>
      {children}
    </label>
  )
}
