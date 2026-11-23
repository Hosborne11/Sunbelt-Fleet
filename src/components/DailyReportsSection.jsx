import { useEffect, useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { pmAction } from '../lib/pm'

const toList = (text) => text.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)
const badEmails = (list) => list.filter((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))
const hourLabel = (h) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`

// Daily GoAardvark-style reports: Maintenance Due + Daily Utilization, as Excel files, each morning
export default function DailyReportsSection() {
  const [s, setS] = useState(null)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(null)
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState(null)

  async function load() {
    const { data, error: err } = await supabase.from('report_settings').select('*').eq('id', true).maybeSingle()
    if (err || !data) return setError(err?.message || 'Run migration 018 first.')
    setS(data)
    setForm({
      enabled: data.enabled, recipients: (data.recipients || []).join(', '), send_hour: data.send_hour,
      pm_due_within_hours: String(data.pm_due_within_hours), workday_hours: String(data.workday_hours),
      send_maintenance_due: data.send_maintenance_due, send_daily_utilization: data.send_daily_utilization,
    })
  }
  useEffect(() => {
    load()
  }, [])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    setError(null)
    setMsg(null)
    const recipients = toList(form.recipients)
    const bad = badEmails(recipients)
    if (bad.length) return setError(`These don't look like email addresses: ${bad.join(', ')}`)
    if (form.enabled && !recipients.length) return setError('Add at least one recipient, or switch the daily email off.')
    const within = Number(form.pm_due_within_hours), day = Number(form.workday_hours)
    if (!(within > 0) || !(day > 0)) return setError('The hour settings need to be numbers above zero.')
    setSaving(true)
    const { error: err } = await supabase.from('report_settings').update({
      enabled: form.enabled, recipients, send_hour: Number(form.send_hour), pm_due_within_hours: within,
      workday_hours: day, send_maintenance_due: form.send_maintenance_due, send_daily_utilization: form.send_daily_utilization,
    }).eq('id', true)
    setSaving(false)
    if (err) return setError(err.message)
    setMsg('Saved.')
    load()
  }

  async function sendNow(to) {
    if (to === 'list' && !window.confirm('Send today’s reports to everyone on the list now?')) return
    setError(null)
    setMsg(null)
    setSending(to)
    const { data, error: err } = await pmAction('reports_send_now', { to })
    setSending(null)
    if (err) return setError(err)
    if (data?.ok === false) return setError(data.error || 'The reports didn’t send.')
    setMsg(`Sent to ${(data?.to || []).join(', ')}.`)
  }

  if (!form) return error ? <p className="text-sm text-rust-400">{error}</p> : null

  return (
    <section className="space-y-3 rounded border border-graphite-700 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-ink-100">Daily reports</div>
        <label className="flex items-center gap-2 text-sm text-ink-300">
          <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          Email them every morning
        </label>
      </div>
      <p className="text-xs text-ink-500">
        Maintenance Due and Daily Utilization, in the same layout as GoAardvark, attached as Excel files. They go out
        after the morning close-out, so Daily Utilization covers the full prior day.
      </p>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-500">Send to</span>
        <textarea rows={2} value={form.recipients} onChange={(e) => set('recipients', e.target.value)} className="input w-full"
                  placeholder="name@sunbeltutilities.com, another@sunbeltutilities.com" />
      </label>

      <div className="grid grid-cols-3 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-500">Send at (Eastern)</span>
          <select value={form.send_hour} onChange={(e) => set('send_hour', e.target.value)} className="input w-full">
            {Array.from({ length: 24 }, (_, h) => h).filter((h) => h >= 6).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-500">PMs due within (hrs)</span>
          <input type="number" min="1" value={form.pm_due_within_hours} onChange={(e) => set('pm_due_within_hours', e.target.value)} className="input w-full font-mono" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-500">Workday for Util % (hrs)</span>
          <input type="number" min="1" step="0.5" value={form.workday_hours} onChange={(e) => set('workday_hours', e.target.value)} className="input w-full font-mono" />
        </label>
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-ink-300">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.send_maintenance_due} onChange={(e) => set('send_maintenance_due', e.target.checked)} />
          Maintenance Due
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.send_daily_utilization} onChange={(e) => set('send_daily_utilization', e.target.checked)} />
          Daily Utilization
        </label>
      </div>

      <p className="text-xs text-ink-500">
        {s?.last_sent_on ? `Last sent automatically for ${s.last_sent_on}.` : 'Not sent automatically yet.'}
        {s?.last_error && <span className="block text-rust-400">Last problem: {s.last_error}</span>}
      </p>

      {error && <p className="text-sm text-rust-400">{error}</p>}
      {msg && <p className="text-sm text-teal-400">{msg}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={saving}
                className="rounded bg-amber-400 px-3.5 py-1.5 text-sm font-medium text-graphite-950 hover:bg-amber-400/90 disabled:opacity-60">
          {saving ? 'Saving…' : 'Save daily reports'}
        </button>
        <button type="button" onClick={() => sendNow('me')} disabled={!!sending}
                className="flex items-center gap-1.5 rounded border border-graphite-600 px-3 py-1.5 text-sm text-ink-300 hover:bg-graphite-700 disabled:opacity-60">
          {sending === 'me' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send to me now
        </button>
        <button type="button" onClick={() => sendNow('list')} disabled={!!sending}
                className="rounded px-3 py-1.5 text-sm text-ink-500 hover:text-ink-300 disabled:opacity-60">
          {sending === 'list' ? 'Sending…' : 'Send to the list now'}
        </button>
      </div>
    </section>
  )
}
