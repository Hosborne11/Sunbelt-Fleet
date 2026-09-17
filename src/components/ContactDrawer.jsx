import { useEffect, useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

const METHODS = ['Work Email', 'Work Cell', 'Work Phone']

const EMPTY = {
  name: '',
  preferred_method: '',
  work_email: '',
  work_cell: '',
  work_phone: '',
  notes: '',
}

export default function ContactDrawer({ contact, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (contact) {
      setForm({
        ...EMPTY,
        ...contact,
        preferred_method: contact.preferred_method || '',
        work_email: contact.work_email || '',
        work_cell: contact.work_cell || '',
        work_phone: contact.work_phone || '',
        notes: contact.notes || '',
      })
    } else {
      setForm(EMPTY)
    }
  }, [contact])

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('Name is required.')
      return
    }
    setSaving(true)
    setError(null)

    const payload = {
      name: form.name.trim(),
      preferred_method: form.preferred_method || null,
      work_email: form.work_email.trim() || null,
      work_cell: form.work_cell.trim() || null,
      work_phone: form.work_phone.trim() || null,
      notes: form.notes.trim() || null,
    }

    const query = contact
      ? supabase.from('contacts').update(payload).eq('id', contact.id)
      : supabase.from('contacts').insert(payload)

    const { error: err } = await query
    setSaving(false)

    if (err) {
      setError(err.message)
      return
    }
    onSaved()
  }

  async function handleDelete() {
    if (!contact) return
    if (!window.confirm(`Delete ${contact.name}? This can't be undone.`)) return
    setSaving(true)
    const { error: err } = await supabase.from('contacts').delete().eq('id', contact.id)
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
            {contact ? 'Edit contact' : 'New contact'}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-ink-500 hover:bg-graphite-700 hover:text-ink-100"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <Field label="Name" required>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} className="input" />
          </Field>

          <Field label="Preferred contact method">
            <select
              value={form.preferred_method}
              onChange={(e) => set('preferred_method', e.target.value)}
              className="input"
            >
              <option value="">—</option>
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Work email">
            <input
              type="email"
              value={form.work_email}
              onChange={(e) => set('work_email', e.target.value)}
              className="input"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Work cell">
              <input
                value={form.work_cell}
                onChange={(e) => set('work_cell', e.target.value)}
                className="input font-mono"
              />
            </Field>
            <Field label="Work phone">
              <input
                value={form.work_phone}
                onChange={(e) => set('work_phone', e.target.value)}
                className="input font-mono"
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
            {contact ? (
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
              {saving ? 'Saving…' : contact ? 'Save changes' : 'Add contact'}
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
