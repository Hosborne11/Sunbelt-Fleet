import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fmtTime } from '../lib/pm'

// Confirmed PM services by date (proposed dates optional), filterable by vendor and crew
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function monthGrid(year, month) {
  const first = new Date(year, month, 1)
  const start = new Date(first)
  start.setDate(1 - ((first.getDay() + 6) % 7)) // back to Monday
  const days = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    days.push(d)
  }
  // drop a trailing week that's entirely next month
  return days[35].getMonth() !== month ? days.slice(0, 35) : days
}

const label = (e) => [e.asset_number, [e.make, e.model].filter(Boolean).join(' ')].filter(Boolean).join(' ')
const tone = (e) =>
  e.status === 'completed' ? 'border-graphite-700 bg-graphite-800/60 text-ink-500 line-through decoration-ink-500/60'
    : e.confirmed ? 'border-teal-500/40 bg-teal-500/15 text-ink-100'
    : 'border-dashed border-amber-400/50 bg-transparent text-amber-400'

export default function PmCalendarPage() {
  const now = new Date()
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [events, setEvents] = useState(null)
  const [error, setError] = useState(null)
  const [vendor, setVendor] = useState('')
  const [crew, setCrew] = useState('')
  const [showProposed, setShowProposed] = useState(true)
  const [showDone, setShowDone] = useState(true)

  const days = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor])
  const from = iso(days[0])
  const to = iso(days[days.length - 1])

  useEffect(() => {
    let cancelled = false
    supabase.from('pm_calendar').select('*').gte('service_date', from).lte('service_date', to)
      .order('service_date').order('service_time', { nullsFirst: true })
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) setError(err.message)
        setEvents(data || [])
      })
    return () => { cancelled = true }
  }, [from, to])

  const vendors = useMemo(() => [...new Set((events || []).map((e) => e.vendor_name).filter(Boolean))].sort(), [events])
  const crews = useMemo(() => [...new Set((events || []).map((e) => e.crew_name).filter(Boolean))].sort(), [events])
  const shown = (events || []).filter((e) =>
    (!vendor || e.vendor_name === vendor) && (!crew || e.crew_name === crew) &&
    (showProposed || e.confirmed) && (showDone || e.status !== 'completed'))
  const byDay = useMemo(() => {
    const m = new Map()
    for (const e of shown) m.set(e.service_date, [...(m.get(e.service_date) || []), e])
    return m
  }, [shown])

  const today = iso(now)
  const monthName = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const step = (n) => setCursor(({ y, m }) => {
    const d = new Date(y, m + n, 1)
    return { y: d.getFullYear(), m: d.getMonth() }
  })
  const monthEvents = shown.filter((e) => Number(e.service_date.slice(5, 7)) - 1 === cursor.m)
  const confirmedCount = monthEvents.filter((e) => e.confirmed && e.status !== 'completed').length

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-graphite-700 px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-100">PM calendar</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {confirmedCount} confirmed service{confirmedCount === 1 ? '' : 's'} in {monthName}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select value={vendor} onChange={(e) => setVendor(e.target.value)} className="input py-1 text-xs">
            <option value="">All vendors</option>
            {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={crew} onChange={(e) => setCrew(e.target.value)} className="input py-1 text-xs">
            <option value="">All crews</option>
            {crews.map((c) => <option key={c} value={c}>{c} crew</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-ink-300">
            <input type="checkbox" checked={showProposed} onChange={(e) => setShowProposed(e.target.checked)} /> Proposed dates
          </label>
          <label className="flex items-center gap-1.5 text-ink-300">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Completed
          </label>
        </div>
      </header>

      <div className="flex items-center gap-2 px-6 py-3">
        <button type="button" onClick={() => step(-1)} className="rounded p-1 text-ink-300 hover:bg-graphite-700" aria-label="Previous month">
          <ChevronLeft size={16} />
        </button>
        <button type="button" onClick={() => step(1)} className="rounded p-1 text-ink-300 hover:bg-graphite-700" aria-label="Next month">
          <ChevronRight size={16} />
        </button>
        <span className="text-base font-medium text-ink-100">{monthName}</span>
        <button type="button" onClick={() => setCursor({ y: now.getFullYear(), m: now.getMonth() })}
                className="ml-2 rounded border border-graphite-600 px-2 py-0.5 text-xs text-ink-300 hover:bg-graphite-700">
          Today
        </button>
        <span className="ml-auto flex items-center gap-3 text-[11px] text-ink-500">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-teal-500/40 bg-teal-500/15" /> Confirmed</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-amber-400/60" /> Proposed, not accepted</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-graphite-700 bg-graphite-800" /> Completed</span>
        </span>
      </div>

      {error && <p className="px-6 text-sm text-rust-400">{error}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {/* Month grid (wide screens) */}
        <div className="hidden overflow-hidden rounded border border-graphite-700 md:block">
          <div className="grid grid-cols-7 bg-graphite-900 text-xs text-ink-500">
            {WEEKDAYS.map((d) => <div key={d} className="px-2 py-1.5">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const key = iso(d)
              const list = byDay.get(key) || []
              const other = d.getMonth() !== cursor.m
              return (
                <div key={key} className={`min-h-[6.5rem] border-t border-l border-graphite-800 p-1.5 first:border-l-0 ${other ? 'bg-graphite-900/40' : ''}`}>
                  <div className={`mb-1 text-xs ${key === today ? 'inline-block rounded bg-amber-400 px-1.5 font-semibold text-graphite-950' : other ? 'text-ink-500/60' : 'text-ink-500'}`}>
                    {d.getDate()}
                  </div>
                  <div className="space-y-1">
                    {list.map((e) => (
                      <Link key={e.request_id} to={`/assets/${e.asset_id}`}
                            title={[label(e), e.vendor_name, e.jobsite, e.service_time && fmtTime(e.service_time)].filter(Boolean).join(' · ')}
                            className={`block truncate rounded border px-1.5 py-0.5 text-[11px] leading-tight ${tone(e)}`}>
                        {e.service_time && <span className="font-mono">{fmtTime(e.service_time)} </span>}
                        {label(e)}
                      </Link>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Agenda (all screens) */}
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-ink-100">{monthName}, by day</h2>
          {events === null && <p className="text-sm text-ink-500">Loading…</p>}
          {events !== null && monthEvents.length === 0 && (
            <p className="text-sm text-ink-500">No PM services this month{vendor || crew ? ' for these filters' : ''}.</p>
          )}
          <div className="divide-y divide-graphite-800 rounded border border-graphite-700">
            {[...new Set(monthEvents.map((e) => e.service_date))].map((day) => (
              <div key={day} className="flex gap-4 px-3 py-2">
                <div className={`w-24 shrink-0 text-sm ${day === today ? 'font-semibold text-amber-400' : 'text-ink-300'}`}>
                  {new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  {monthEvents.filter((e) => e.service_date === day).map((e) => (
                    <Link key={e.request_id} to={`/assets/${e.asset_id}`} className="flex flex-wrap items-baseline gap-x-3 text-sm hover:text-amber-400">
                      <span className={`font-medium ${e.status === 'completed' ? 'text-ink-500 line-through' : e.confirmed ? 'text-ink-100' : 'text-amber-400'}`}>
                        {label(e)}
                      </span>
                      <span className="text-xs text-ink-500">
                        {[e.service_time && fmtTime(e.service_time), e.vendor_name, e.jobsite,
                          !e.confirmed && e.status !== 'completed' && 'proposed, not accepted',
                          e.site_contact_name && `site contact ${e.site_contact_name}${e.site_contact_phone ? ` ${e.site_contact_phone}` : ''}`]
                          .filter(Boolean).join(' · ')}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
