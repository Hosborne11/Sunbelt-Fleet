import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Trash2, CheckCircle2, FileText, Paperclip } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { computeDue, needsScheduling, fmtDate } from '../lib/maintenanceDue'
import { openFile, PM_BUCKET, FILES_BUCKET } from '../lib/pm'
import ServiceRequestPanel from './ServiceRequestPanel'

const EMPTY = {
  asset_id: '',
  name: '',
  interval_hours: '',
  interval_days: '',
  last_service_hours: '',
  last_service_date: '',
  next_due_hours: '',
  scheduled_for: '',
  scheduled_note: '',
  active: true,
  notes: '',
}

const today = () => new Date().toLocaleDateString('en-CA')
const num = (v) => (v !== '' && v != null ? Number(v) : null)

export default function MaintenancePlanDrawer({ plan, assets, defaultAssetId, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState(EMPTY)
  const [hourMeter, setHourMeter] = useState(null)
  const [services, setServices] = useState([])
  const [logOpen, setLogOpen] = useState(false)
  const [log, setLog] = useState({ performed_on: today(), hours: '', performed_by: '', cost: '', notes: '' })
  const [logFile, setLogFile] = useState(null)
  // Request actions (send / cancel) happen without closing; refresh the page behind us on close
  const changedRef = useRef(false)
  const close = () => (changedRef.current ? onSaved() : onClose())
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
        next_due_hours: plan.next_due_hours ?? '',
        scheduled_for: plan.scheduled_for || '',
        scheduled_note: plan.scheduled_note || '',
        notes: plan.notes || '',
      })
    } else {
      setForm({ ...EMPTY, asset_id: defaultAssetId || '', name: '500-hour PM', interval_hours: '500' })
    }
  }, [plan, defaultAssetId])

  // Current hour meter + service history for the plan
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (form.asset_id) {
        const { data } = await supabase.from('assets').select('hour_meter').eq('id', form.asset_id).single()
        if (!cancelled) {
          setHourMeter(data?.hour_meter ?? null)
          setLog((l) => ({ ...l, hours: data?.hour_meter != null ? String(Math.round(data.hour_meter)) : '' }))
        }
      }
      if (plan?.id) {
        const { data } = await supabase
          .from('maintenance_services')
          .select('*, file:asset_files(bucket, path, file_name)')
          .eq('plan_id', plan.id)
          .order('performed_on', { ascending: false })
          .limit(10)
        if (!cancelled) setServices(data || [])
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [form.asset_id, plan?.id])

  const due = useMemo(
    () => computeDue({ ...form, next_due_hours: num(form.next_due_hours), interval_hours: num(form.interval_hours),
                       last_service_hours: num(form.last_service_hours), interval_days: num(form.interval_days) }, hourMeter),
    [form, hourMeter]
  )
  const flag = plan && needsScheduling(form, due)
  const assumed = form.last_service_hours === '' && form.interval_hours !== ''

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.asset_id) return setError('Asset is required.')
    if (!form.name.trim()) return setError('Name is required.')
    if (!form.interval_hours && !form.interval_days) return setError('Set an hour interval, a day interval, or both.')
    setSaving(true)
    setError(null)

    const payload = {
      asset_id: form.asset_id,
      name: form.name.trim(),
      interval_hours: num(form.interval_hours),
      interval_days: num(form.interval_days),
      last_service_hours: num(form.last_service_hours),
      last_service_date: form.last_service_date || null,
      next_due_hours: num(form.next_due_hours),
      scheduled_for: form.scheduled_for || null,
      scheduled_note: form.scheduled_note.trim() || null,
      active: form.active,
      notes: form.notes.trim() || null,
    }
    const { error: err } = plan
      ? await supabase.from('maintenance_plans').update(payload).eq('id', plan.id)
      : await supabase.from('maintenance_plans').insert(payload)
    setSaving(false)
    if (err) return setError(err.message)
    onSaved()
  }

  async function logService() {
    if (!log.performed_on) return setError('Enter the date the service was done.')
    if (form.interval_hours && log.hours === '') return setError('Enter the hour meter reading at the service.')
    setSaving(true)
    setError(null)
    // Work order goes into the machine's files
    let file_id = null
    if (logFile) {
      const safe = logFile.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
      const path = `${form.asset_id}/work-orders/manual-${Date.now()}-${safe}`
      const { error: upErr } = await supabase.storage.from(FILES_BUCKET).upload(path, logFile)
      if (upErr) {
        setSaving(false)
        return setError(`Work order upload failed: ${upErr.message}`)
      }
      const { data: who } = await supabase.auth.getUser()
      const { data: file, error: fileErr } = await supabase.from('asset_files').insert({
        asset_id: form.asset_id, bucket: FILES_BUCKET, path, file_name: logFile.name,
        content_type: logFile.type || null, size_bytes: logFile.size, category: 'work_order',
        uploaded_by: who?.user?.email || null, notes: `PM service ${log.performed_on}`,
      }).select('id').single()
      if (fileErr) {
        setSaving(false)
        return setError(fileErr.message)
      }
      file_id = file.id
    }
    const { error: err } = await supabase.from('maintenance_services').insert({
      plan_id: plan.id,
      asset_id: form.asset_id,
      performed_on: log.performed_on,
      hours: num(log.hours),
      performed_by: log.performed_by.trim() || null,
      cost: num(log.cost),
      notes: log.notes.trim() || null,
      file_id,
    })
    setSaving(false)
    if (err) return setError(err.message)
    onSaved()
  }

  async function deleteService(s) {
    if (!window.confirm(`Remove the service logged on ${s.performed_on}?`)) return
    const { error: err } = await supabase.from('maintenance_services').delete().eq('id', s.id)
    if (err) return setError(err.message)
    setServices((list) => list.filter((x) => x.id !== s.id))
  }

  async function handleDelete() {
    if (!plan) return
    if (!window.confirm(`Delete "${plan.name}" and its service history? This can't be undone.`)) return
    setSaving(true)
    const { error: err } = await supabase.from('maintenance_plans').delete().eq('id', plan.id)
    setSaving(false)
    if (err) return setError(err.message)
    onDeleted()
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={close}>
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-graphite-700 bg-graphite-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-graphite-700 px-5 py-4">
          <h2 className="text-base font-semibold text-ink-100">
            {plan ? 'Maintenance plan' : 'New maintenance plan'}
          </h2>
          <button onClick={close} className="rounded p-1 text-ink-500 hover:bg-graphite-700 hover:text-ink-100">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Where this plan stands */}
          {plan && (
            <div className="rounded border border-graphite-700 bg-graphite-900/60 px-3 py-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="Hour meter" value={hourMeter != null ? Math.round(hourMeter).toLocaleString() : '—'} />
                <Stat label="Due at" value={due.dueAtHours != null ? Math.round(due.dueAtHours).toLocaleString() : '—'} />
                <Stat
                  label={due.hoursRemaining != null && due.hoursRemaining < 0 ? 'Hours over' : 'Hours left'}
                  value={due.hoursRemaining != null ? Math.abs(Math.round(due.hoursRemaining)).toLocaleString() : '—'}
                  tone={due.status}
                />
              </div>
              {assumed && due.dueAtHours != null && (
                <p className="mt-2 text-xs text-ink-500">
                  Last PM not recorded yet, so this assumes the next {form.interval_hours}-hour mark. Enter the
                  last service below to correct it.
                </p>
              )}
            </div>
          )}

          {/* Scheduling: request from the vendor, or set a date by hand */}
          {plan && (
            <ServiceRequestPanel
              plan={plan}
              due={due}
              flag={flag}
              scheduledFor={form.scheduled_for}
              scheduledNote={form.scheduled_note}
              onManualChange={set}
              onChanged={() => { changedRef.current = true }}
            />
          )}

          <Field label="Asset" required>
            <select value={form.asset_id} onChange={(e) => set('asset_id', e.target.value)} className="input" disabled={!!plan}>
              <option value="">—</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>{a.asset_number}</option>
              ))}
            </select>
          </Field>

          <Field label="Plan name" required>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} className="input" placeholder="e.g. 500-hour PM" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Interval (hours)">
              <input type="number" value={form.interval_hours} onChange={(e) => set('interval_hours', e.target.value)} className="input font-mono" placeholder="500" />
            </Field>
            <Field label="Interval (days)">
              <input type="number" value={form.interval_days} onChange={(e) => set('interval_days', e.target.value)} className="input font-mono" placeholder="optional" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Last service, hours">
              <input type="number" value={form.last_service_hours} onChange={(e) => set('last_service_hours', e.target.value)} className="input font-mono" />
            </Field>
            <Field label="Last service, date">
              <input type="date" value={form.last_service_date} onChange={(e) => set('last_service_date', e.target.value)} className="input" />
            </Field>
          </div>

          <Field label="Next due at (hours)">
            <input type="number" value={form.next_due_hours} onChange={(e) => set('next_due_hours', e.target.value)} className="input font-mono" />
            <span className="mt-1 block text-xs text-ink-500">
              Recalculated automatically when the last service or interval changes. Override it only if needed.
            </span>
          </Field>

          <label className="flex items-center gap-2 text-sm text-ink-300">
            <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)}
                   className="h-4 w-4 rounded border-graphite-600 bg-graphite-900" />
            Active
          </label>

          <Field label="Notes">
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} className="input min-h-[64px] resize-y" />
          </Field>

          {/* Log a completed PM */}
          {plan && (
            <div className="rounded border border-graphite-700 px-3 py-3">
              {!logOpen ? (
                <button type="button" onClick={() => setLogOpen(true)}
                        className="flex items-center gap-1.5 text-sm font-medium text-teal-400 hover:text-teal-300">
                  <CheckCircle2 size={15} /> Log a completed service
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="text-sm font-medium text-ink-100">Log a completed service</div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Date done" required>
                      <input type="date" value={log.performed_on} onChange={(e) => setLog({ ...log, performed_on: e.target.value })} className="input" />
                    </Field>
                    <Field label="Hour meter at service" required={!!form.interval_hours}>
                      <input type="number" value={log.hours} onChange={(e) => setLog({ ...log, hours: e.target.value })} className="input font-mono" />
                    </Field>
                    <Field label="Done by">
                      <input value={log.performed_by} onChange={(e) => setLog({ ...log, performed_by: e.target.value })} className="input" />
                    </Field>
                    <Field label="Cost">
                      <input type="number" value={log.cost} onChange={(e) => setLog({ ...log, cost: e.target.value })} className="input font-mono" />
                    </Field>
                  </div>
                  <Field label="Notes">
                    <input value={log.notes} onChange={(e) => setLog({ ...log, notes: e.target.value })} className="input" />
                  </Field>
                  <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-graphite-600 px-3 py-2 text-sm text-ink-300 hover:border-amber-400/60">
                    <Paperclip size={14} className="shrink-0 text-ink-500" />
                    <span className="truncate">{logFile ? logFile.name : 'Attach the work order (optional)'}</span>
                    <input type="file" accept=".pdf,image/*" className="sr-only" onChange={(e) => setLogFile(e.target.files?.[0] || null)} />
                  </label>
                  <p className="text-xs text-ink-500">
                    Saving sets the next PM to {log.hours !== '' && form.interval_hours ? `${(Number(log.hours) + Number(form.interval_hours)).toLocaleString()} hours` : 'this reading plus the interval'} and clears the scheduled date.
                  </p>
                  <div className="flex gap-2">
                    <button type="button" onClick={logService} disabled={saving}
                            className="rounded bg-teal-500 px-3 py-1.5 text-sm font-medium text-graphite-950 hover:bg-teal-400 disabled:opacity-60">
                      Save service
                    </button>
                    <button type="button" onClick={() => setLogOpen(false)}
                            className="rounded border border-graphite-600 px-3 py-1.5 text-sm text-ink-300 hover:bg-graphite-700">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {services.length > 0 && (
                <div className="mt-3 border-t border-graphite-700 pt-2">
                  <div className="mb-1 text-xs font-medium text-ink-500">Service history</div>
                  <ul className="space-y-1 text-sm">
                    {services.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-2">
                        <span className="text-ink-300">
                          {fmtDate(s.performed_on)}, {s.hours != null ? `${Math.round(s.hours).toLocaleString()} hrs` : 'no reading'}
                          {s.performed_by ? `, ${s.performed_by}` : ''}
                        </span>
                        {(s.file || s.attachment_path) && (
                          <button type="button" title={s.file?.file_name || 'Open work order'}
                                  onClick={() => (s.file ? openFile(s.file.path, s.file.bucket) : openFile(s.attachment_path, PM_BUCKET))}
                                  className="ml-auto flex items-center gap-1 text-xs text-amber-400 hover:underline">
                            <FileText size={12} /> WO
                          </button>
                        )}
                        <button type="button" onClick={() => deleteService(s)} className="text-ink-500 hover:text-rust-400" aria-label="Remove service">
                          <Trash2 size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-rust-400">{error}</p>}

          <div className="flex items-center justify-between pt-2">
            {plan ? (
              <button type="button" onClick={handleDelete} disabled={saving}
                      className="flex items-center gap-1.5 rounded px-3 py-2 text-sm text-rust-400 hover:bg-rust-500/10">
                <Trash2 size={15} /> Delete plan
              </button>
            ) : (
              <span />
            )}
            <button type="submit" disabled={saving}
                    className="rounded bg-amber-400 px-4 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90 disabled:opacity-60">
              {saving ? 'Saving…' : plan ? 'Save changes' : 'Create plan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }) {
  const color = tone === 'overdue' ? 'text-rust-400' : tone === 'due_soon' ? 'text-amber-400' : 'text-ink-100'
  return (
    <div>
      <div className={`font-mono text-base font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-ink-500">{label}</div>
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
