import { useEffect, useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

const TYPES = ['maintenance', 'repair']
const PRIORITIES = ['low', 'normal', 'high']
const STATUSES = ['open', 'in_progress', 'closed']

const EMPTY = {
  title: '',
  description: '',
  type: 'maintenance',
  status: 'open',
  priority: 'normal',
  asset_id: '',
  assigned_to: '',
  due_date: '',
  cost: '',
  notes: '',
}

export default function WorkOrderDrawer({ workOrder, assets, defaultAssetId, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (workOrder) {
      setForm({
        ...EMPTY,
        ...workOrder,
        asset_id: workOrder.asset_id || '',
        due_date: workOrder.due_date || '',
        description: workOrder.description || '',
        assigned_to: workOrder.assigned_to || '',
        cost: workOrder.cost ?? '',
        notes: workOrder.notes || '',
      })
    } else {
      setForm({ ...EMPTY, asset_id: defaultAssetId || '' })
    }
  }, [workOrder])

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) {
      setError('Title is required.')
      return
    }
    setSaving(true)
    setError(null)

    const wasOpen = workOrder && workOrder.status !== 'closed'
    const nowClosing = form.status === 'closed'

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      type: form.type,
      status: form.status,
      priority: form.priority,
      asset_id: form.asset_id || null,
      assigned_to: form.assigned_to.trim() || null,
      due_date: form.due_date || null,
      cost: form.cost !== '' ? Number(form.cost) : null,
      notes: form.notes.trim() || null,
      closed_at: nowClosing ? (workOrder?.closed_at ?? new Date().toISOString()) : null,
    }
    void wasOpen

    const query = workOrder
      ? supabase.from('work_orders').update(payload).eq('id', workOrder.id)
      : supabase.from('work_orders').insert(payload)

    const { error: err } = await query
    setSaving(false)

    if (err) {
      setError(err.message)
      return
    }
    onSaved()
  }

  async function handleDelete() {
    if (!workOrder) return
    if (!window.confirm(`Delete work order "${workOrder.title}"? This can't be undone.`)) return
    setSaving(true)
    const { error: err } = await supabase.from('work_orders').delete().eq('id', workOrder.id)
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
            {workOrder ? 'Edit work order' : 'New work order'}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-ink-500 hover:bg-graphite-700 hover:text-ink-100"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <Field label="Title" required>
            <input
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              className="input"
              placeholder="e.g. Replace hydraulic hose"
            />
          </Field>

          <Field label="Asset">
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

          <div className="grid grid-cols-3 gap-3">
            <Field label="Type">
              <select value={form.type} onChange={(e) => set('type', e.target.value)} className="input">
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select
                value={form.priority}
                onChange={(e) => set('priority', e.target.value)}
                className="input"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => set('status', e.target.value)}
                className="input"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Assigned to">
              <input
                value={form.assigned_to}
                onChange={(e) => set('assigned_to', e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Cost">
              <input
                type="number"
                value={form.cost}
                onChange={(e) => set('cost', e.target.value)}
                className="input font-mono"
                placeholder="0.00"
              />
            </Field>
          </div>

          <Field label="Due date">
            <input
              type="date"
              value={form.due_date}
              onChange={(e) => set('due_date', e.target.value)}
              className="input"
            />
          </Field>

          <Field label="Description">
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              className="input min-h-[72px] resize-y"
            />
          </Field>

          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              className="input min-h-[60px] resize-y"
            />
          </Field>

          {error && <p className="text-sm text-rust-400">{error}</p>}

          <div className="flex items-center justify-between pt-2">
            {workOrder ? (
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
              {saving ? 'Saving…' : workOrder ? 'Save changes' : 'Create work order'}
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
