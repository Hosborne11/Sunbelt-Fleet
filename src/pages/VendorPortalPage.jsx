import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CalendarCheck2, CheckCircle2, FileUp, MapPin, Wrench } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { pmAction, fmtDay, fmtTime, PM_BUCKET } from '../lib/pm'

// Public page the vendor opens from the emailed link. No sign-in: the link itself is the key.
export default function VendorPortalPage() {
  const { token } = useParams()
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  const [view, setView] = useState(null) // 'schedule' | 'complete' | 'reschedule' | 'done'
  const [doneMessage, setDoneMessage] = useState(null)

  const load = useCallback(async () => {
    const { data, error: err } = await pmAction('portal_get', { token })
    if (err) return setError(err)
    setInfo(data)
    const datePassed = data.scheduled_date && data.scheduled_date <= data.today
    setView(
      data.status === 'requested' ? 'schedule'
      : data.status === 'awaiting_confirmation' || (data.status === 'scheduled' && datePassed) ? 'complete'
      : data.status === 'scheduled' ? 'scheduled'
      : 'closed'
    )
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  if (error) {
    return (
      <Frame>
        <p className="text-ink-100">{error}</p>
        <p className="mt-1 text-sm text-ink-500">If you think this is a mistake, reply to the email you received.</p>
      </Frame>
    )
  }
  if (!info) return <Frame><p className="text-sm text-ink-500">Loading…</p></Frame>

  const m = info.machine
  const finished = (msg) => {
    setDoneMessage(msg)
    setView('done')
  }

  return (
    <Frame vendor={info.vendor_name}>
      <MachineCard info={info} />

      {view === 'done' && (
        <Notice icon={CheckCircle2} tone="teal" title="Thank you">{doneMessage}</Notice>
      )}

      {view === 'closed' && info.status === 'completed' && (
        <Notice icon={CheckCircle2} tone="teal" title="Service confirmed">
          Recorded on {fmtDay(info.completed_on)} at {Math.round(info.completed_hours).toLocaleString()} hours. Thank you.
        </Notice>
      )}
      {view === 'closed' && info.status === 'cancelled' && (
        <Notice icon={CalendarCheck2} tone="ink" title="Request cancelled">Sunbelt Utilities cancelled this request. No action is needed.</Notice>
      )}

      {view === 'scheduled' && (
        <div className="space-y-3">
          <Notice icon={CalendarCheck2} tone="teal" title="Scheduled">
            {fmtDay(info.scheduled_date)}
            {info.scheduled_time ? ` at ${fmtTime(info.scheduled_time)}` : ''}
            {info.scheduled_notes ? `. ${info.scheduled_notes}` : ''}
          </Notice>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setView('reschedule')} secondary>Change the date</Button>
            <Button onClick={() => setView('complete')} secondary>The service is done</Button>
          </div>
        </div>
      )}

      {(view === 'schedule' || view === 'reschedule') && (
        <ScheduleForm
          token={token}
          info={info}
          title={view === 'schedule' ? 'Pick a service date' : 'Change the service date'}
          onCancel={view === 'reschedule' ? () => setView('scheduled') : null}
          onDone={(d, t) =>
            finished(`Scheduled for ${fmtDay(d)}${t ? ` at ${fmtTime(t)}` : ''}. After the service we'll email you a link to confirm it.`)
          }
        />
      )}

      {view === 'complete' && (
        <CompleteForm
          token={token}
          info={info}
          onDone={(r) =>
            finished(
              r.status === 'completed'
                ? `Service recorded for ${m.asset_number}.${r.next_due_hours ? ` Its next PM is due at ${Math.round(r.next_due_hours).toLocaleString()} hours.` : ''}`
                : `New date saved: ${fmtDay(r.scheduled_date)}.`
            )
          }
        />
      )}
    </Frame>
  )
}

function Frame({ vendor, children }) {
  return (
    <div className="min-h-screen bg-graphite-900 px-4 py-8">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-5">
          <div className="font-mono text-xs uppercase tracking-wide text-ink-500">Sunbelt Utilities</div>
          <div className="text-xl font-semibold text-ink-100">PM service{vendor ? ` for ${vendor}` : ''}</div>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </div>
  )
}

function MachineCard({ info }) {
  const m = info.machine
  const row = (label, value) =>
    value ? (
      <div className="flex justify-between gap-4 py-1 text-sm">
        <span className="text-ink-500">{label}</span>
        <span className="text-right text-ink-100">{value}</span>
      </div>
    ) : null
  return (
    <div className="rounded border border-graphite-700 bg-graphite-800/60 px-4 py-3">
      <div className="flex items-center gap-2 font-medium text-ink-100">
        <Wrench size={16} strokeWidth={1.75} className="text-amber-400" />
        {m.asset_number} {m.make || m.model ? `(${[m.make, m.model].filter(Boolean).join(' ')})` : ''}
      </div>
      <div className="mt-2 divide-y divide-graphite-700/60">
        {row('Serial / PIN', m.serial_number)}
        {row('Service', info.plan.name)}
        {row('Hour meter now', m.hour_meter != null ? `${Math.round(m.hour_meter).toLocaleString()} hrs` : null)}
        {row('PM due at', info.plan.next_due_hours != null ? `${Math.round(info.plan.next_due_hours).toLocaleString()} hrs` : null)}
        {row('Jobsite', [info.location.jobsite, info.location.address].filter(Boolean).join(', '))}
        {row('Preferred date', info.preferred_date ? fmtDay(info.preferred_date) : null)}
        {row('Notes', info.requested_notes)}
        {row('Requested by', info.requested_by)}
      </div>
      {info.location.map_url && (
        <a href={info.location.map_url} target="_blank" rel="noreferrer"
           className="mt-2 inline-flex items-center gap-1.5 text-sm text-amber-400 hover:underline">
          <MapPin size={14} /> Machine location in Google Maps
        </a>
      )}
    </div>
  )
}

function ScheduleForm({ token, info, title, onCancel, onDone }) {
  const [date, setDate] = useState(info.scheduled_date || info.preferred_date || '')
  const [time, setTime] = useState(info.scheduled_time || '')
  const [notes, setNotes] = useState(info.scheduled_notes || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (!date) return setError('Pick a date.')
    setBusy(true)
    setError(null)
    const { error: err } = await pmAction('portal_schedule', { token, date, time: time || null, notes })
    setBusy(false)
    if (err) return setError(err)
    onDone(date, time)
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded border border-graphite-700 px-4 py-4">
      <div className="text-sm font-medium text-ink-100">{title}</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" required>
          <input type="date" min={info.today} value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </Field>
        <Field label="Start time (optional)">
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input" />
        </Field>
      </div>
      <Field label="Notes for Sunbelt (optional)">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input resize-y"
                  placeholder="e.g. tech name, parts on order, call ahead" />
      </Field>
      {error && <p className="text-sm text-rust-400">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Confirm date'}</Button>
        {onCancel && <Button onClick={onCancel} secondary>Back</Button>}
      </div>
    </form>
  )
}

function CompleteForm({ token, info, onDone }) {
  const [completed, setCompleted] = useState(true)
  const [performedOn, setPerformedOn] = useState(
    info.scheduled_date && info.scheduled_date <= info.today ? info.scheduled_date : info.today
  )
  const [hours, setHours] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState(null)
  const [newDate, setNewDate] = useState('')
  const [newTime, setNewTime] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setError(null)
    if (!completed) {
      if (!newDate) return setError('Pick the new service date.')
      setBusy('Saving…')
      const { data, error: err } = await pmAction('portal_complete', {
        token, completed: false, new_date: newDate, new_time: newTime || null, notes,
      })
      setBusy(null)
      return err ? setError(err) : onDone(data)
    }
    if (!hours || Number(hours) <= 0) return setError('Enter the hour meter reading at the time of service.')

    let workOrderPath = null
    if (file) {
      setBusy('Uploading work order…')
      const { data: up, error: upErr } = await pmAction('portal_upload_url', { token, filename: file.name })
      if (upErr) {
        setBusy(null)
        return setError(upErr)
      }
      const { error: putErr } = await supabase.storage.from(PM_BUCKET).uploadToSignedUrl(up.path, up.upload_token, file)
      if (putErr) {
        setBusy(null)
        return setError(`Upload failed: ${putErr.message}`)
      }
      workOrderPath = up.path
    }
    setBusy('Saving…')
    const { data, error: err } = await pmAction('portal_complete', {
      token, completed: true, performed_on: performedOn, hours: Number(hours), notes, work_order_path: workOrderPath,
    })
    setBusy(null)
    return err ? setError(err) : onDone(data)
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded border border-graphite-700 px-4 py-4">
      <div className="text-sm font-medium text-ink-100">Was the service completed?</div>
      <div className="flex gap-2">
        <Choice active={completed} onClick={() => setCompleted(true)}>Yes, it's done</Choice>
        <Choice active={!completed} onClick={() => setCompleted(false)}>No, pick a new date</Choice>
      </div>

      {completed ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date done" required>
              <input type="date" max={info.today} value={performedOn} onChange={(e) => setPerformedOn(e.target.value)} className="input" />
            </Field>
            <Field label="Hour meter at service" required>
              <input type="number" inputMode="decimal" step="0.1" min="0" value={hours}
                     onChange={(e) => setHours(e.target.value)} className="input font-mono"
                     placeholder={info.machine.hour_meter != null ? String(Math.round(info.machine.hour_meter)) : ''} />
            </Field>
          </div>
          <Field label="Work order (optional)">
            <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-graphite-600 px-3 py-2.5 text-sm text-ink-300 hover:border-amber-400/60">
              <FileUp size={16} className="shrink-0 text-ink-500" />
              <span className="truncate">{file ? file.name : 'Attach a PDF or photo'}</span>
              <input type="file" accept=".pdf,image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
          </Field>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="New date" required>
            <input type="date" min={info.today} value={newDate} onChange={(e) => setNewDate(e.target.value)} className="input" />
          </Field>
          <Field label="Start time (optional)">
            <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="input" />
          </Field>
        </div>
      )}

      <Field label="Notes (optional)">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input resize-y" />
      </Field>
      {error && <p className="text-sm text-rust-400">{error}</p>}
      <Button type="submit" disabled={!!busy}>{busy || (completed ? 'Confirm service' : 'Save new date')}</Button>
    </form>
  )
}

function Notice({ icon: Icon, tone, title, children }) {
  const color = tone === 'teal' ? 'text-teal-400' : 'text-ink-300'
  return (
    <div className="rounded border border-graphite-700 bg-graphite-800/40 px-4 py-3">
      <div className={`flex items-center gap-2 text-sm font-medium ${color}`}>
        <Icon size={16} strokeWidth={1.75} /> {title}
      </div>
      <p className="mt-1 text-sm text-ink-300">{children}</p>
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-500">
        {label}
        {required && <span className="text-amber-400"> *</span>}
      </span>
      {children}
    </label>
  )
}

function Choice({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
            className={`rounded border px-3 py-1.5 text-sm ${active ? 'border-amber-400 bg-amber-400/10 text-amber-400' : 'border-graphite-600 text-ink-300 hover:bg-graphite-700'}`}>
      {children}
    </button>
  )
}

function Button({ children, secondary, type = 'button', ...rest }) {
  return (
    <button type={type} {...rest}
            className={secondary
              ? 'rounded border border-graphite-600 px-3.5 py-2 text-sm text-ink-300 hover:bg-graphite-700 disabled:opacity-60'
              : 'rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90 disabled:opacity-60'}>
      {children}
    </button>
  )
}
