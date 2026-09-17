import { useEffect, useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

const STATUSES = ['pending', 'confirmed', 'cancelled']

const EMPTY = {
  asset_id: '',
  category_id: '',
  from_date: new Date().toISOString().slice(0, 10),
  to_date: '',
  location: '',
  requester: '',
  status: 'confirmed',
  notes: '',
}

export default function ReservationDrawer({
  reservation,
  assets,
  categories,
  onClose,
  onSaved,
  onDeleted,
}) {
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (reservation) {
      setForm({
        ...EMPTY,
        ...reservation,
        asset_id: reservation.asset_id || '',
        category_id: reservation.category_id || '',
        to_date: reservation.to_date || '',
        location: reservation.location || '',
        requester: reservation.requester || '',
        notes: reservation.notes || '',
      })
    } else {
      setForm(EMPTY)
    }
  }, [reservation])

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.asset_id && !form.category_id) {
      setError('Pick a specific asset or at least a category.')
      return
    }
    setSaving(true)
    setError(null)

    const payload = {
      asset_id: form.asset_id || null,
      category_id: form.category_id || null,
      from_date: form.from_date,
      to_date: form.to_date || null,
      location: form.location.trim() || null,
      requester: form.requester.trim() || null,
      status: form.status,
      notes: form.notes.trim() || null,
    }

    const query = reservation
      ? supabase.from('reservations').update(payload).eq('id', reservation.id)
      : supabase.from('reservations').insert(payload)

    const { error: err } = await query
    setSaving(false)

    if (err) {
      setError(err.message)
      return
    }
    onSaved()
  }

  async function handleDelete() {
    if (!reservation) return
    if (!window.confirm("Delete this reservation? This can't be undone.")) return
    setSaving(true)
    const { error: err } = await supabase.from('reservations').delete().eq('id', reservation.id)
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
            {reservation ? 'Edit reservation' : 'New reservation'}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-ink-500 hover:bg-graphite-700 hover:text-ink-100"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <Field label="Specific asset">
            <select
              value={form.asset_id}
              onChange={(e) => set('asset_id', e.target.value)}
              className="input"
            >
              <option value="">— none, reserve by category below —</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.asset_number}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Category (if no specific asset picked)">
            <select
              value={form.category_id}
              onChange={(e) => set('category_id', e.target.value)}
              className="input"
            >
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="From" required>
              <input
                type="date"
                value={form.from_date}
                onChange={(e) => set('from_date', e.target.value)}
                className="input"
              />
            </Field>
            <Field label="To">
              <input
                type="date"
                value={form.to_date}
                onChange={(e) => set('to_date', e.target.value)}
                className="input"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Location">
              <input
                value={form.location}
                onChange={(e) => set('location', e.target.value)}
                className="input"
                placeholder="Jobsite or address"
              />
            </Field>
            <Field label="Requester">
              <input
                value={form.requester}
                onChange={(e) => set('requester', e.target.value)}
                className="input"
              />
            </Field>
          </div>

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

          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              className="input min-h-[72px] resize-y"
            />
          </Field>

          {error && <p className="text-sm text-rust-400">{error}</p>}

          <div className="flex items-center justify-between pt-2">
            {reservation ? (
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
              {saving ? 'Saving…' : reservation ? 'Save changes' : 'Create reservation'}
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
