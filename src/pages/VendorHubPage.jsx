import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CalendarClock, MapPin, Phone, Loader2 } from 'lucide-react'
import { pmAction, fmtDay, fmtTime } from '../lib/pm'

// A vendor's own page (no sign-in): every open Sunbelt PM service assigned to them.
// They can propose dates and ask to move a confirmed date; Sunbelt accepts changes in Fleet.

const SECTIONS = [
  { status: 'requested', title: 'Needs a date', blurb: 'Propose the date that works with your schedule.' },
  { status: 'proposed', title: 'Waiting for Sunbelt', blurb: 'Your proposed date is waiting to be accepted.' },
  { status: 'scheduled', title: 'Scheduled', blurb: 'Confirmed. Ask for a change here if a date no longer works.' },
  { status: 'awaiting_confirmation', title: 'Done? Send the work order', blurb: 'Confirm the service and attach the work order.' },
  { status: 'completed', title: 'Completed recently', blurb: '' },
]

const machineName = (m) => [m.asset_number, [m.make, m.model].filter(Boolean).join(' ')].filter(Boolean).join(' - ')
const sortDate = (it) => it.scheduled_date || it.proposed_date || it.preferred_date || '9999-12-31'

export default function VendorHubPage() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    const { data: res, error: err } = await pmAction('vendor_get', { token })
    if (err) {
      setError(/Failed to send a request/i.test(err) ? 'We couldn’t load your list right now. Please try again in a few minutes.' : err)
      return
    }
    setError(null)
    setData(res)
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="min-h-screen bg-graphite-950 text-ink-100">
      <div className="mx-auto max-w-3xl px-5 py-8">
        <div className="font-mono text-xs uppercase tracking-wide text-ink-500">Sunbelt Utilities</div>
        <h1 className="mt-1 text-2xl font-semibold">PM services{data ? ` for ${data.vendor_name}` : ''}</h1>

        {!data && !error && (
          <p className="mt-6 flex items-center gap-2 text-sm text-ink-500"><Loader2 size={14} className="animate-spin" /> Loading…</p>
        )}
        {error && (
          <div className="mt-6">
            <p className="text-ink-100">{error}</p>
            <p className="mt-2 text-sm text-ink-500">If you think this is a mistake, reply to any email from Sunbelt&rsquo;s fleet system.</p>
          </div>
        )}

        {data && data.items.length === 0 && (
          <p className="mt-6 text-sm text-ink-300">Nothing open right now. New requests from Sunbelt will show up here.</p>
        )}

        {data && SECTIONS.map((sec) => {
          const items = data.items.filter((it) => it.status === sec.status)
            .sort((a, b) => (sortDate(a) < sortDate(b) ? -1 : 1))
          if (!items.length) return null
          return (
            <section key={sec.status} className="mt-8">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-semibold">{sec.title} <span className="text-sm font-normal text-ink-500">({items.length})</span></h2>
              </div>
              {sec.blurb && <p className="text-sm text-ink-500">{sec.blurb}</p>}
              <div className="mt-3 space-y-3">
                {items.map((it) => <ServiceCard key={it.id} item={it} token={token} today={data.today} onChanged={load} />)}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function ServiceCard({ item, token, today, onChanged }) {
  const [changing, setChanging] = useState(false)
  const sc = item.site_contact || {}
  const loc = item.location || {}
  const canPropose = ['requested', 'proposed', 'scheduled'].includes(item.status)
  const proposeLabel = item.status === 'requested' ? 'Propose a date'
    : item.status === 'proposed' ? 'Change your proposed date' : 'Request a date change'

  return (
    <div className="rounded border border-graphite-700 bg-graphite-900/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{machineName(item.machine)}</div>
          <div className="text-xs text-ink-500">
            {[item.plan?.name, item.machine?.serial_number && `Serial ${item.machine.serial_number}`].filter(Boolean).join(', ')}
          </div>
        </div>
        <DateBadge item={item} />
      </div>

      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <MapPin size={15} className="mt-0.5 shrink-0 text-ink-500" />
          <div className="min-w-0">
            <div className="text-ink-300">{[loc.jobsite, loc.address].filter(Boolean).join(', ') || 'Location not known yet'}</div>
            {loc.map_url && <a href={loc.map_url} target="_blank" rel="noreferrer" className="text-xs text-amber-400 hover:underline">Open in Google Maps</a>}
          </div>
        </div>
        <div className="flex gap-2">
          <Phone size={15} className="mt-0.5 shrink-0 text-ink-500" />
          <div className="min-w-0 text-ink-300">
            {sc.name || sc.phone || sc.email ? (
              <>
                <div>{sc.name || 'Site contact'}</div>
                <div className="text-xs">
                  {sc.phone && <a href={`tel:${String(sc.phone).replace(/[^\d+]/g, '')}`} className="text-amber-400 hover:underline">{sc.phone}</a>}
                  {sc.phone && sc.email && ', '}
                  {sc.email && <a href={`mailto:${sc.email}`} className="text-amber-400 hover:underline">{sc.email}</a>}
                </div>
              </>
            ) : <span className="text-ink-500">No site contact given</span>}
          </div>
        </div>
      </div>

      {(item.requested_notes || item.proposed_notes || item.scheduled_notes) && (
        <div className="mt-2 space-y-0.5 text-xs text-ink-500">
          {item.requested_notes && <div>Sunbelt&rsquo;s note: <span className="text-ink-300">{item.requested_notes}</span></div>}
          {item.status === 'proposed' && item.proposed_notes && <div>Your note: <span className="text-ink-300">{item.proposed_notes}</span></div>}
          {item.status !== 'proposed' && item.scheduled_notes && <div>Your note: <span className="text-ink-300">{item.scheduled_notes}</span></div>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canPropose && !changing && (
          <button type="button" onClick={() => setChanging(true)}
                  className="flex items-center gap-1.5 rounded bg-amber-400 px-3 py-1.5 text-sm font-medium text-graphite-950 hover:bg-amber-400/90">
            <CalendarClock size={14} /> {proposeLabel}
          </button>
        )}
        {item.status === 'awaiting_confirmation' && (
          <Link to={`/pm/r/${item.token}`} className="rounded bg-amber-400 px-3 py-1.5 text-sm font-medium text-graphite-950 hover:bg-amber-400/90">
            Confirm and attach the work order
          </Link>
        )}
        {item.reconfirm_open && (
          <Link to={`/pm/r/${item.token}`} className="rounded border border-amber-400/60 px-3 py-1.5 text-sm text-amber-400 hover:bg-amber-400/10">
            Confirm it&rsquo;s still on
          </Link>
        )}
        <Link to={`/pm/r/${item.token}`} className="rounded px-2 py-1.5 text-sm text-ink-500 hover:text-ink-300">Open this service</Link>
      </div>

      {changing && (
        <ProposeForm item={item} token={token} today={today}
                     onCancel={() => setChanging(false)}
                     onDone={() => { setChanging(false); onChanged() }} />
      )}
    </div>
  )
}

function DateBadge({ item }) {
  if (item.status === 'completed') {
    return <div className="text-right text-sm text-ink-500">Completed {item.completed_on ? fmtDay(item.completed_on) : ''}</div>
  }
  if (item.status === 'scheduled' || item.status === 'awaiting_confirmation') {
    return (
      <div className="text-right">
        <div className="text-sm font-medium text-ink-100">{fmtDay(item.scheduled_date)}</div>
        <div className="text-xs text-ink-500">{item.scheduled_time ? fmtTime(item.scheduled_time) : 'Confirmed'}</div>
      </div>
    )
  }
  if (item.status === 'proposed') {
    return (
      <div className="text-right">
        <div className="text-sm text-ink-300">{fmtDay(item.proposed_date)}</div>
        <div className="text-xs text-amber-400">Waiting for Sunbelt</div>
      </div>
    )
  }
  return (
    <div className="text-right text-xs text-ink-500">
      {item.preferred_date ? <>Sunbelt prefers<div className="text-sm text-ink-300">{fmtDay(item.preferred_date)}</div></> : 'No date yet'}
    </div>
  )
}

function ProposeForm({ item, token, today, onCancel, onDone }) {
  const [date, setDate] = useState(item.proposed_date || item.scheduled_date || item.preferred_date || '')
  const [time, setTime] = useState(item.proposed_time || item.scheduled_time || '')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const moving = item.status === 'scheduled'

  async function submit() {
    setError(null)
    if (!date) return setError('Pick a date.')
    setBusy(true)
    const { error: err } = await pmAction('vendor_propose', { token, request_id: item.id, date, time: time || null, notes })
    setBusy(false)
    if (err) return setError(err)
    onDone()
  }

  return (
    <div className="mt-3 space-y-3 rounded border border-graphite-700 p-3">
      {moving && (
        <p className="text-xs text-ink-500">
          Sunbelt has to accept the new date before it&rsquo;s confirmed. They&rsquo;ll get an email right away.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-500">Date</span>
          <input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} className="input w-full" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-500">Time (optional)</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input w-full" />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-500">{moving ? 'Reason for the change (optional)' : 'Note for Sunbelt (optional)'}</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input w-full" />
      </label>
      {error && <p className="text-sm text-rust-400">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={busy}
                className="rounded bg-amber-400 px-3 py-1.5 text-sm font-medium text-graphite-950 hover:bg-amber-400/90 disabled:opacity-60">
          {busy ? 'Sending…' : moving ? 'Send change request' : 'Send to Sunbelt'}
        </button>
        <button type="button" onClick={onCancel} className="rounded px-3 py-1.5 text-sm text-ink-500 hover:text-ink-300">Cancel</button>
      </div>
    </div>
  )
}
