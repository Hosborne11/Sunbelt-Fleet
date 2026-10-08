import { useCallback, useEffect, useState } from 'react'
import { CalendarCheck2, CalendarClock, CalendarX2, Copy, Send, XCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { pmAction, REQUEST_STATUS, fmtDay, fmtTime, fmtStamp } from '../lib/pm'
import { DUE_SOON_HOURS } from '../lib/maintenanceDue'

const OPEN = ['requested', 'proposed', 'scheduled', 'awaiting_confirmation']

// Scheduling for one PM plan: request it from the vendor (default) or set a date by hand.
export default function ServiceRequestPanel({ plan, due, flag, scheduledFor, scheduledNote, onManualChange, onChanged }) {
  const [request, setRequest] = useState(undefined) // undefined = loading, null = none open
  const [lastEmail, setLastEmail] = useState(null)
  const [vendor, setVendor] = useState('the vendor')
  const [preferred, setPreferred] = useState('')
  const [notes, setNotes] = useState('')
  const [manual, setManual] = useState(!!scheduledFor)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [declining, setDeclining] = useState(false)
  const [declineNote, setDeclineNote] = useState('')

  const load = useCallback(async () => {
    const [rRes, sRes] = await Promise.all([
      supabase.from('pm_requests').select('*').eq('plan_id', plan.id).in('status', OPEN).maybeSingle(),
      supabase.from('pm_settings').select('vendor_name, vendor_contact_email').eq('id', true).maybeSingle(),
    ])
    setRequest(rRes.data || null)
    if (sRes.data?.vendor_name) setVendor(sRes.data.vendor_name)
    if (rRes.data) {
      const { data: log } = await supabase.from('pm_email_log').select('*').eq('request_id', rRes.data.id)
        .order('sent_at', { ascending: false }).limit(1).maybeSingle()
      setLastEmail(log || null)
    } else {
      setLastEmail(null)
    }
  }, [plan.id])

  useEffect(() => {
    load()
  }, [load])

  async function run(label, action, payload, okMessage) {
    setBusy(label)
    setError(null)
    setNotice(null)
    const { data, error: err } = await pmAction(action, payload)
    setBusy(null)
    if (err) return setError(err)
    if (data?.email_ok === false) setError(`Saved, but the email didn't send: ${data.email_error || 'check PM Workflow settings'}`)
    else if (okMessage) setNotice(okMessage)
    onChanged()
    load()
  }

  const sendRequest = () =>
    run('Sending…', 'request', { plan_id: plan.id, preferred_date: preferred || null, notes }, `Request sent to ${vendor}.`)
  const resend = () => run('Sending…', 'resend', { request_id: request.id }, 'Email sent again.')
  const accept = () =>
    run('Accepting…', 'accept', { request_id: request.id }, `Accepted. ${vendor} has been told the date is confirmed.`)
  const decline = async () => {
    await run('Sending…', 'decline', { request_id: request.id, note: declineNote }, `${vendor} was asked for another date.`)
    setDeclining(false)
    setDeclineNote('')
  }
  const cancel = () => {
    if (!window.confirm(`Cancel this request? ${vendor} will be told it's cancelled.`)) return
    run('Cancelling…', 'cancel', { request_id: request.id }, 'Request cancelled.')
  }
  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/pm/r/${request.token}`)
    setNotice('Vendor link copied. You can text it to them.')
  }

  const st = request ? REQUEST_STATUS[request.status] : null

  return (
    <div className={`rounded border px-3 py-3 ${flag && !request ? 'border-amber-400/50 bg-amber-400/5' : 'border-graphite-700'}`}>
      <div className="flex items-center gap-2 text-sm font-medium text-ink-100">
        <CalendarClock size={15} strokeWidth={1.75} className={flag && !request ? 'text-amber-400' : 'text-ink-500'} />
        Schedule
        {st && (
          <span className={`ml-auto rounded border px-1.5 text-[11px] ${st.tone === 'teal' ? 'border-teal-500/40 text-teal-400' : 'border-amber-400/50 text-amber-400'}`}>
            {st.label}
          </span>
        )}
      </div>

      {request === undefined && <p className="mt-2 text-xs text-ink-500">Loading…</p>}

      {/* Open request with the vendor */}
      {request && (
        <div className="mt-2 space-y-2 text-sm">
          {request.status === 'requested' && (
            <p className="text-ink-300">
              Requested from {request.vendor_name || vendor} {fmtStamp(request.requested_at)}. Waiting for them to propose a date.
            </p>
          )}
          {request.status === 'proposed' && (
            <div className="space-y-2 rounded border border-amber-400/40 bg-amber-400/5 px-3 py-2">
              <p className="text-ink-100">
                {request.previous_date ? 'New date proposed: ' : 'Proposed: '}
                {fmtDay(request.proposed_date)}
                {request.proposed_time ? ` at ${fmtTime(request.proposed_time)}` : ''}
                {request.previous_date && <span className="text-ink-500"> (was {fmtDay(request.previous_date)})</span>}
              </p>
              {request.proposed_notes && <p className="text-xs text-ink-300">Dealer notes: {request.proposed_notes}</p>}
              {!declining ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={accept} disabled={!!busy}
                          className="flex items-center gap-1.5 rounded bg-amber-400 px-3 py-1.5 text-sm font-medium text-graphite-950 hover:bg-amber-400/90 disabled:opacity-60">
                    <CalendarCheck2 size={14} /> {busy || 'Accept date'}
                  </button>
                  <SmallButton icon={CalendarX2} onClick={() => setDeclining(true)} disabled={!!busy}>Ask for another date</SmallButton>
                </div>
              ) : (
                <div className="space-y-2">
                  <input value={declineNote} onChange={(e) => setDeclineNote(e.target.value)} className="input"
                         placeholder="Optional note, e.g. machine is on a pour that week" />
                  <div className="flex gap-2">
                    <SmallButton icon={Send} onClick={decline} disabled={!!busy}>Send to {request.vendor_name || vendor}</SmallButton>
                    <SmallButton icon={XCircle} onClick={() => setDeclining(false)} disabled={!!busy}>Never mind</SmallButton>
                  </div>
                </div>
              )}
            </div>
          )}
          {(request.status === 'scheduled' || request.status === 'awaiting_confirmation') && (
            <p className="text-ink-100">
              {fmtDay(request.scheduled_date)}
              {request.scheduled_time ? ` at ${fmtTime(request.scheduled_time)}` : ''}
              <span className="text-ink-500"> with {request.vendor_name || vendor}</span>
            </p>
          )}
          {request.scheduled_notes && request.status !== 'proposed' && (
            <p className="text-xs text-ink-300">Dealer notes: {request.scheduled_notes}</p>
          )}
          {request.status === 'scheduled' && request.reconfirm_sent_at && (
            <p className={`text-xs ${request.reconfirmed_at ? 'text-teal-400' : 'text-amber-400'}`}>
              {request.reconfirmed_at
                ? `Dealer confirmed it's still on (${fmtStamp(request.reconfirmed_at)}).`
                : 'Waiting for the dealer to confirm it is still on.'}
            </p>
          )}
          {request.status === 'awaiting_confirmation' && (
            <p className="text-xs text-amber-400">
              Waiting for {request.vendor_name || vendor} to confirm the service and send the work order ({request.followup_count} request
              {request.followup_count === 1 ? '' : 's'} sent).
            </p>
          )}
          <ul className="space-y-0.5 text-xs text-ink-500">
            <li>Requested {fmtStamp(request.requested_at)}{request.requested_by ? ` by ${request.requested_by}` : ''}</li>
            {request.accepted_at && <li>Date accepted {fmtStamp(request.accepted_at)}{request.accepted_by ? ` by ${request.accepted_by}` : ''}</li>}
            {request.reminder_24h_sent_at && <li>Foreman notice sent {fmtStamp(request.reminder_24h_sent_at)}</li>}
            {request.reminder_day_sent_at && <li>Morning-of reminder sent {fmtStamp(request.reminder_day_sent_at)}</li>}
            {request.last_followup_at && <li>Completion request sent {fmtStamp(request.last_followup_at)}</li>}
          </ul>
          {lastEmail && !lastEmail.ok && (
            <p className="text-xs text-rust-400">Last email didn't send: {lastEmail.error}</p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <SmallButton icon={Send} onClick={resend} disabled={!!busy}>Resend email</SmallButton>
            <SmallButton icon={Copy} onClick={copyLink} disabled={!!busy}>Copy vendor link</SmallButton>
            <SmallButton icon={XCircle} onClick={cancel} disabled={!!busy} tone="rust">Cancel request</SmallButton>
          </div>
        </div>
      )}

      {/* No open request: ask the vendor, or set a date by hand */}
      {request === null && (
        <div className="mt-2 space-y-3">
          {flag && (
            <p className="text-xs text-amber-400">
              {due.status === 'overdue' ? 'Overdue.' : `Due within ${DUE_SOON_HOURS} hours.`} Request it from {vendor}, or
              set the date yourself.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-500">Preferred date (optional)</span>
              <input type="date" value={preferred} onChange={(e) => setPreferred(e.target.value)} className="input" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-500">Note for {vendor} (optional)</span>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input" placeholder="e.g. at the yard Fridays" />
            </label>
          </div>
          <button type="button" onClick={sendRequest} disabled={!!busy}
                  className="flex items-center gap-1.5 rounded bg-amber-400 px-3 py-1.5 text-sm font-medium text-graphite-950 hover:bg-amber-400/90 disabled:opacity-60">
            <Send size={14} /> {busy || `Request service from ${vendor}`}
          </button>

          <div className="border-t border-graphite-700 pt-2">
            {!manual ? (
              <button type="button" onClick={() => setManual(true)} className="text-xs text-ink-500 hover:text-ink-100">
                Or set the date yourself
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink-500">Scheduled for</span>
                  <input type="date" value={scheduledFor} onChange={(e) => onManualChange('scheduled_for', e.target.value)} className="input" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink-500">Where / who</span>
                  <input value={scheduledNote} onChange={(e) => onManualChange('scheduled_note', e.target.value)} className="input" placeholder="e.g. Shop" />
                </label>
                <p className="col-span-2 text-xs text-ink-500">Saved with the plan. No emails are sent for dates set by hand.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-rust-400">{error}</p>}
      {notice && <p className="mt-2 text-xs text-teal-400">{notice}</p>}
    </div>
  )
}

function SmallButton({ icon: Icon, children, tone, ...rest }) {
  return (
    <button type="button" {...rest}
            className={`flex items-center gap-1 rounded border border-graphite-600 px-2 py-1 text-xs disabled:opacity-60 ${
              tone === 'rust' ? 'text-ink-300 hover:bg-rust-500/10 hover:text-rust-400' : 'text-ink-300 hover:bg-graphite-700'}`}>
      <Icon size={12} /> {children}
    </button>
  )
}
