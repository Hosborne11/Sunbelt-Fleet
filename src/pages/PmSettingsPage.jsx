import { useEffect, useState } from 'react'
import { Mail, Send } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { pmAction, fmtStamp } from '../lib/pm'

const toList = (text) =>
  text.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)
const badEmails = (list) => list.filter((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))

// Who gets PM workflow emails: the vendor contact (requests, follow-ups) and the
// foreman distro (24-hour and morning-of reminders).
export default function PmSettingsPage() {
  const [form, setForm] = useState(null)
  const [log, setLog] = useState([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)
  const [testing, setTesting] = useState(false)

  async function load() {
    const [sRes, lRes] = await Promise.all([
      supabase.from('pm_settings').select('*').eq('id', true).single(),
      supabase.from('pm_email_log').select('*').order('sent_at', { ascending: false }).limit(25),
    ])
    if (sRes.error) return setError(sRes.error.message)
    const s = sRes.data
    setForm({
      vendor_name: s.vendor_name || '',
      vendor_contact_name: s.vendor_contact_name || '',
      vendor_contact_email: s.vendor_contact_email || '',
      vendor_cc: (s.vendor_cc || []).join(', '),
      reminder_recipients: (s.reminder_recipients || []).join(', '),
      notify_recipients: (s.notify_recipients || []).join(', '),
    })
    setLog(lRes.data || [])
  }

  useEffect(() => {
    load()
  }, [])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  async function save(e) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    const lists = {
      vendor_cc: toList(form.vendor_cc),
      reminder_recipients: toList(form.reminder_recipients),
      notify_recipients: toList(form.notify_recipients),
    }
    const contact = form.vendor_contact_email.trim().toLowerCase()
    const bad = badEmails([...(contact ? [contact] : []), ...Object.values(lists).flat()])
    if (bad.length) return setError(`These don't look like email addresses: ${bad.join(', ')}`)
    if (!contact) return setError("The vendor contact's email is required to send requests.")
    setSaving(true)
    const { error: err } = await supabase
      .from('pm_settings')
      .update({
        vendor_name: form.vendor_name.trim() || 'James River Equipment',
        vendor_contact_name: form.vendor_contact_name.trim() || null,
        vendor_contact_email: contact,
        ...lists,
        updated_at: new Date().toISOString(),
      })
      .eq('id', true)
    setSaving(false)
    if (err) return setError(err.message)
    setMessage('Saved.')
    load()
  }

  async function sendTest() {
    setTesting(true)
    setError(null)
    setMessage(null)
    const { data, error: err } = await pmAction('test_email')
    setTesting(false)
    if (err) return setError(err)
    if (!data.email_ok) return setError(`Test email failed: ${data.email_error}`)
    setMessage('Test email sent to you. Check your inbox.')
  }

  if (!form) {
    return <div className="px-6 py-6 text-sm text-ink-500">{error || 'Loading…'}</div>
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-6">
        <h1 className="text-xl font-semibold text-ink-100">PM workflow</h1>
        <p className="mt-1 text-sm text-ink-500">
          Who gets emails when a PM service is requested from the vendor, scheduled, and completed.
        </p>

        <form onSubmit={save} className="mt-6 space-y-6">
          <section className="space-y-3 rounded border border-graphite-700 px-4 py-4">
            <div className="text-sm font-medium text-ink-100">Service vendor</div>
            <p className="text-xs text-ink-500">
              Gets the service request with a link to pick a date, and the follow-up after the service to confirm it
              and attach the work order.
            </p>
            <Field label="Company">
              <input value={form.vendor_name} onChange={(e) => set('vendor_name', e.target.value)} className="input" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Contact name">
                <input value={form.vendor_contact_name} onChange={(e) => set('vendor_contact_name', e.target.value)} className="input" />
              </Field>
              <Field label="Contact email" required>
                <input type="email" value={form.vendor_contact_email} onChange={(e) => set('vendor_contact_email', e.target.value)} className="input" />
              </Field>
            </div>
            <Field label="Also copy at the vendor (optional)" hint="Separate addresses with commas.">
              <input value={form.vendor_cc} onChange={(e) => set('vendor_cc', e.target.value)} className="input" />
            </Field>
          </section>

          <section className="space-y-3 rounded border border-graphite-700 px-4 py-4">
            <div className="text-sm font-medium text-ink-100">Service reminders</div>
            <p className="text-xs text-ink-500">
              Sent about 24 hours before each scheduled service (7:00 AM the day before if no time was given) and at
              6:00 AM the morning of. Use your foreman distribution list.
            </p>
            <Field label="Reminder recipients" hint="Separate addresses with commas.">
              <input value={form.reminder_recipients} onChange={(e) => set('reminder_recipients', e.target.value)} className="input"
                     placeholder="foremen@sunbeltutilities.com" />
            </Field>
          </section>

          <section className="space-y-3 rounded border border-graphite-700 px-4 py-4">
            <div className="text-sm font-medium text-ink-100">Updates</div>
            <p className="text-xs text-ink-500">
              Whoever sends a request is always told when the vendor schedules it and when it's completed. Add anyone
              else who should get those updates.
            </p>
            <Field label="Also notify (optional)" hint="Separate addresses with commas.">
              <input value={form.notify_recipients} onChange={(e) => set('notify_recipients', e.target.value)} className="input" />
            </Field>
          </section>

          {error && <p className="text-sm text-rust-400">{error}</p>}
          {message && <p className="text-sm text-teal-400">{message}</p>}

          <div className="flex items-center gap-2">
            <button type="submit" disabled={saving}
                    className="rounded bg-amber-400 px-4 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90 disabled:opacity-60">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={sendTest} disabled={testing}
                    className="flex items-center gap-1.5 rounded border border-graphite-600 px-3.5 py-2 text-sm text-ink-300 hover:bg-graphite-700 disabled:opacity-60">
              <Send size={14} /> {testing ? 'Sending…' : 'Send me a test email'}
            </button>
          </div>
        </form>

        <section className="mt-8">
          <div className="flex items-center gap-2 text-sm font-medium text-ink-100">
            <Mail size={15} strokeWidth={1.75} className="text-ink-500" /> Recent emails
          </div>
          {log.length === 0 ? (
            <p className="mt-2 text-sm text-ink-500">None sent yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-graphite-800 rounded border border-graphite-800 text-sm">
              {log.map((l) => (
                <li key={l.id} className="px-3 py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-ink-100" title={l.subject || ''}>{l.subject || l.kind}</span>
                    <span className="shrink-0 text-xs text-ink-500">{fmtStamp(l.sent_at)}</span>
                  </div>
                  <div className={`truncate text-xs ${l.ok ? 'text-ink-500' : 'text-rust-400'}`}>
                    {l.ok ? `Sent to ${(l.recipients || []).join(', ')}` : `Not sent: ${l.error}`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function Field({ label, required, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-500">
        {label}
        {required && <span className="text-amber-400"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-500">{hint}</span>}
    </label>
  )
}
