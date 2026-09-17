import { useEffect, useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

const STATUSES = ['active', 'expired', 'terminated']

const EMPTY = {
  asset_id: '',
  lessee: '',
  monthly_rate: '',
  start_date: new Date().toISOString().slice(0, 10),
  end_date: '',
  status: 'active',
  notes: '',
}

export default function LeaseDrawer({ lease, assets, defaultAssetId, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (lease) {
      setForm({
        ...EMPTY,
        ...lease,
        asset_id: lease.asset_id || '',
        lessee: lease.lessee || '',
        monthly_rate: lease.monthly_rate ?? '',
        end_date: lease.end_date || '',
        notes: lease.notes || '',
      })
    } else {
      setForm({ ...EMPTY, asset_id: defaultAssetId || '' })
    }
  }, [lease])

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.asset_id) {
      setError('Asset is required.')
      return
    }
    if (!form.lessee.trim()) {
      setError('Lessee is required.')
      return
    }
    setSaving(true)
    setError(null)

    const payload = {
      asset_id: form.asset_id || null,
      lessee: form.lessee.trim(),
      monthly_rate: form.monthly_rate !== '' ? Number(form.monthly_rate) : null,
      start_date: form.start_date,
      end_date: form.end_date || null,
      status: form.status,
      notes: form.notes.trim() || null,
    }

    const query = lease
      ? supabase.from('leases').update(payload).eq('id', lease.id)
      : supabase.from('leases').insert(payload)

    const { error: err } = await query
    setSaving(false)

    if (err) {
      setError(err.message)
      return
    }
    onSaved()
  }

  async function handleDelete() {
    if (!lease) return
    if (!window.confirm("Delete this lease record? This can't be undone.")) return
    setSaving(true)
    const { error: err } = await supabase.from('leases').delete().eq('id', lease.id)
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
            {lease ? 'Edit lease' : 'New lease'}
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

          <Field label="Lessee" required>
            <input
              value={form.lessee}
              onChange={(e) => set('lessee', e.target.value)}
              className="input"
              placeholder="Company or party name"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Monthly rate">
              <input
                type="number"
                value={form.monthly_rate}
                onChange={(e) => set('monthly_rate', e.target.value)}
                className="input font-mono"
                placeholder="0.00"
              />
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => set('status', e.target.value)}
                className="input"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date">
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => set('start_date', e.target.value)}
                className="input"
              />
            </Field>
            <Field label="End date">
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => set('end_date', e.target.value)}
                className="input"
              />
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              className="input min-h-[72px] resize-y"
            />
          </Field>

          {error && <p className="text-sm text-rust-400">{error}</p>}

          <div className="flex items-center justify-between pt-2">
            {lease ? (
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
              {saving ? 'Saving…' : lease ? 'Save changes' : 'Create lease'}
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
