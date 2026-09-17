import { useEffect, useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

const TYPES = ['daily', 'periodic', 'dot', 'safety']
const RESULTS = ['pass', 'fail', 'needs_attention']

const EMPTY = {
  asset_id: '',
  inspection_type: 'daily',
  result: 'pass',
  inspector: '',
  inspected_at: new Date().toISOString().slice(0, 10),
  notes: '',
}

export default function InspectionDrawer({ inspection, assets, defaultAssetId, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (inspection) {
      setForm({
        ...EMPTY,
        ...inspection,
        asset_id: inspection.asset_id || '',
        inspector: inspection.inspector || '',
        inspected_at: inspection.inspected_at || EMPTY.inspected_at,
        notes: inspection.notes || '',
      })
    } else {
      setForm({ ...EMPTY, asset_id: defaultAssetId || '' })
    }
  }, [inspection])

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.asset_id) {
      setError('Asset is required.')
      return
    }
    setSaving(true)
    setError(null)

    const payload = {
      asset_id: form.asset_id || null,
      inspection_type: form.inspection_type,
      result: form.result,
      inspector: form.inspector.trim() || null,
      inspected_at: form.inspected_at,
      notes: form.notes.trim() || null,
    }

    const query = inspection
      ? supabase.from('inspections').update(payload).eq('id', inspection.id)
      : supabase.from('inspections').insert(payload)

    const { error: err } = await query
    setSaving(false)

    if (err) {
      setError(err.message)
      return
    }
    onSaved()
  }

  async function handleDelete() {
    if (!inspection) return
    if (!window.confirm("Delete this inspection record? This can't be undone.")) return
    setSaving(true)
    const { error: err } = await supabase.from('inspections').delete().eq('id', inspection.id)
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
            {inspection ? 'Edit inspection' : 'New inspection'}
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

          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select
                value={form.inspection_type}
                onChange={(e) => set('inspection_type', e.target.value)}
                className="input"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.toUpperCase()}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Result">
              <select
                value={form.result}
                onChange={(e) => set('result', e.target.value)}
                className="input"
              >
                {RESULTS.map((r) => (
                  <option key={r} value={r}>
                    {r.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Inspector">
              <input
                value={form.inspector}
                onChange={(e) => set('inspector', e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Date">
              <input
                type="date"
                value={form.inspected_at}
                onChange={(e) => set('inspected_at', e.target.value)}
                className="input"
              />
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              className="input min-h-[90px] resize-y"
              placeholder="What was checked, what failed, follow-up needed…"
            />
          </Field>

          {error && <p className="text-sm text-rust-400">{error}</p>}

          <div className="flex items-center justify-between pt-2">
            {inspection ? (
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
              {saving ? 'Saving…' : inspection ? 'Save changes' : 'Log inspection'}
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
