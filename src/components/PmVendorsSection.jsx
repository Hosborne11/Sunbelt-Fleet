import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Search, Star, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

const toList = (text) =>
  text.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)
const badEmails = (list) => list.filter((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))
const byNumber = (a, b) =>
  String(a.asset_number || '').localeCompare(String(b.asset_number || ''), undefined, { numeric: true })
const machineName = (a) => [a.make, a.model].filter(Boolean).join(' ')

// PM service vendors and which machines each one services. Every machine has exactly one vendor:
// its own assignment, or the default vendor if it has none.
export default function PmVendorsSection() {
  const [vendors, setVendors] = useState(null)
  const [assets, setAssets] = useState([])
  const [error, setError] = useState(null)
  const [adding, setAdding] = useState(false)

  async function load() {
    const [vRes, aRes] = await Promise.all([
      supabase.from('pm_vendors').select('*').order('sort_order').order('name'),
      supabase.from('assets').select('id, asset_number, make, model, serial_number, pm_vendor_id')
        .neq('status', 'retired'),
    ])
    if (vRes.error) return setError(vRes.error.message)
    setVendors(vRes.data || [])
    setAssets((aRes.data || []).sort(byNumber))
  }

  useEffect(() => {
    load()
  }, [])

  const defaultId = vendors?.find((v) => v.is_default)?.id ?? null
  const names = useMemo(() => Object.fromEntries((vendors || []).map((v) => [v.id, v.name])), [vendors])
  const vendorOf = (a) => a.pm_vendor_id || defaultId

  // vendorId = the vendor the machines should go to (the default is stored as "no assignment")
  async function assign(ids, vendorId) {
    if (!ids.length) return
    setError(null)
    const value = vendorId === defaultId ? null : vendorId
    setAssets((list) => list.map((a) => (ids.includes(a.id) ? { ...a, pm_vendor_id: value } : a)))
    const { error: err } = await supabase.from('assets').update({ pm_vendor_id: value }).in('id', ids)
    if (err) {
      setError(err.message)
      load()
    }
  }

  async function makeDefault(id) {
    setError(null)
    const { error: err } = await supabase.rpc('set_default_pm_vendor', { p_vendor: id })
    if (err) return setError(err.message)
    load()
  }

  async function remove(v) {
    const count = assets.filter((a) => a.pm_vendor_id === v.id).length
    const msg = `Delete ${v.name}?` +
      (count ? ` Its ${count} machine${count === 1 ? '' : 's'} will go back to ${names[defaultId] || 'the default vendor'}.` : '') +
      ' Open requests already sent to them stay with them.'
    if (!window.confirm(msg)) return
    const { error: err } = await supabase.from('pm_vendors').delete().eq('id', v.id)
    if (err) return setError(err.message)
    load()
  }

  if (!vendors) {
    return <p className="text-sm text-ink-500">{error || 'Loading vendors…'}</p>
  }

  return (
    <section className="space-y-3 rounded border border-graphite-700 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-ink-100">Vendors</div>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)}
                  className="flex items-center gap-1 rounded border border-graphite-600 px-2.5 py-1 text-xs text-ink-300 hover:bg-graphite-700">
            <Plus size={13} /> Add vendor
          </button>
        )}
      </div>
      <p className="text-xs text-ink-500">
        Each machine's PM requests go to its vendor: the request with a link to propose a date, a confirmation once you
        accept it, a check 24 hours before the service, and a request 24 hours after to confirm it and attach the work
        order. Machines not assigned anywhere else go to the default vendor.
      </p>

      {adding && (
        <VendorForm
          onCancel={() => setAdding(false)}
          onSave={async (row) => {
            const { error: err } = await supabase.from('pm_vendors')
              .insert({ ...row, sort_order: vendors.length + 1, is_default: vendors.length === 0 })
            if (err) return err.message.includes('duplicate') ? 'A vendor with that name already exists.' : err.message
            setAdding(false)
            load()
            return null
          }}
        />
      )}

      {vendors.map((v) => (
        <VendorCard
          key={v.id}
          vendor={v}
          isDefault={v.id === defaultId}
          assets={assets}
          vendorOf={vendorOf}
          names={names}
          onAssign={assign}
          onMakeDefault={() => makeDefault(v.id)}
          onDelete={() => remove(v)}
          onSaved={load}
        />
      ))}

      {error && <p className="text-sm text-rust-400">{error}</p>}
    </section>
  )
}

function VendorCard({ vendor, isDefault, assets, vendorOf, names, onAssign, onMakeDefault, onDelete, onSaved }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(!vendor.contact_email)
  const [q, setQ] = useState('')

  const mine = assets.filter((a) => vendorOf(a) === vendor.id)
  const needle = q.trim().toLowerCase()
  const shown = needle
    ? assets.filter((a) =>
        [a.asset_number, a.make, a.model, a.serial_number].filter(Boolean).join(' ').toLowerCase().includes(needle))
    : assets
  const shownIds = shown.map((a) => a.id)

  return (
    <div className="rounded border border-graphite-800 bg-graphite-900/40">
      <div className="flex items-start justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-ink-100">
            <span className="truncate font-medium">{vendor.name}</span>
            {isDefault && (
              <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-400">
                Default
              </span>
            )}
          </div>
          <div className={`truncate text-xs ${vendor.contact_email ? 'text-ink-500' : 'text-rust-400'}`}>
            {vendor.contact_email
              ? [vendor.contact_name, vendor.contact_email].filter(Boolean).join(' · ')
              : 'No contact email yet: requests to this vendor can’t be sent'}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!isDefault && (
            <button type="button" onClick={onMakeDefault} title="New and unassigned machines will use this vendor"
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs text-ink-500 hover:bg-graphite-700 hover:text-ink-300">
              <Star size={12} /> Make default
            </button>
          )}
          <button type="button" onClick={() => setEditing((e) => !e)}
                  className="rounded px-2 py-1 text-xs text-ink-500 hover:bg-graphite-700 hover:text-ink-300">
            {editing ? 'Close' : 'Edit'}
          </button>
          {!isDefault && (
            <button type="button" onClick={onDelete} title="Delete vendor"
                    className="rounded p-1 text-ink-500 hover:bg-graphite-700 hover:text-rust-400">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="border-t border-graphite-800 px-3 py-3">
          <VendorForm
            vendor={vendor}
            onCancel={() => setEditing(false)}
            onSave={async (row) => {
              const { error: err } = await supabase.from('pm_vendors').update(row).eq('id', vendor.id)
              if (err) return err.message.includes('duplicate') ? 'A vendor with that name already exists.' : err.message
              setEditing(false)
              onSaved()
              return null
            }}
          />
        </div>
      )}

      <button type="button" onClick={() => setOpen((o) => !o)}
              className="flex w-full items-center gap-1.5 border-t border-graphite-800 px-3 py-2 text-left text-xs text-ink-300 hover:bg-graphite-800/60">
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Machines <span className="text-ink-500">({mine.length})</span>
      </button>

      {open && (
        <div className="border-t border-graphite-800 px-3 pb-3 pt-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-500" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by number, make, model or serial"
                     className="input w-full pl-7 text-xs" />
            </div>
            {!isDefault && (
              <>
                <button type="button" onClick={() => onAssign(shownIds, vendor.id)}
                        className="rounded border border-graphite-600 px-2 py-1 text-xs text-ink-300 hover:bg-graphite-700">
                  Check all shown
                </button>
                <button type="button"
                        onClick={() => onAssign(shown.filter((a) => vendorOf(a) === vendor.id).map((a) => a.id), null)}
                        className="rounded border border-graphite-600 px-2 py-1 text-xs text-ink-300 hover:bg-graphite-700">
                  Uncheck all shown
                </button>
              </>
            )}
          </div>
          {isDefault && (
            <p className="mt-2 text-xs text-ink-500">
              To move a machine away from {vendor.name}, check it under the other vendor.
            </p>
          )}
          <ul className="mt-2 max-h-72 divide-y divide-graphite-800 overflow-y-auto rounded border border-graphite-800">
            {shown.map((a) => {
              const checked = vendorOf(a) === vendor.id
              const elsewhere = !checked ? names[vendorOf(a)] : null
              const locked = isDefault && checked
              return (
                <li key={a.id}>
                  <label className={`flex items-center gap-2.5 px-2.5 py-1.5 text-sm ${locked ? 'cursor-default' : 'cursor-pointer hover:bg-graphite-800/60'}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={locked}
                      onChange={(e) => onAssign([a.id], e.target.checked ? vendor.id : null)}
                    />
                    <span className="w-14 shrink-0 font-mono text-xs text-ink-300">{a.asset_number}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-100">{machineName(a) || '—'}</span>
                    <span className="hidden shrink-0 font-mono text-[11px] text-ink-500 sm:inline">{a.serial_number}</span>
                    {elsewhere && <span className="shrink-0 text-[11px] text-ink-500">{elsewhere}</span>}
                  </label>
                </li>
              )
            })}
            {shown.length === 0 && <li className="px-2.5 py-2 text-xs text-ink-500">No machines match.</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

function VendorForm({ vendor, onSave, onCancel }) {
  const [name, setName] = useState(vendor?.name || '')
  const [contactName, setContactName] = useState(vendor?.contact_name || '')
  const [email, setEmail] = useState(vendor?.contact_email || '')
  const [cc, setCc] = useState((vendor?.cc || []).join(', '))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function submit() {
    setError(null)
    const contact = email.trim().toLowerCase()
    const ccList = toList(cc)
    if (!name.trim()) return setError('Give the vendor a name.')
    const bad = badEmails([...(contact ? [contact] : []), ...ccList])
    if (bad.length) return setError(`These don't look like email addresses: ${bad.join(', ')}`)
    setSaving(true)
    const err = await onSave({
      name: name.trim(), contact_name: contactName.trim() || null, contact_email: contact || null, cc: ccList,
    })
    setSaving(false)
    if (err) setError(err)
  }

  return (
    <div className="space-y-3">
      <Field label="Company" required>
        <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="National Equipment Dealers" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Contact name">
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} className="input" />
        </Field>
        <Field label="Contact email" hint="Needed before requests can go to this vendor.">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
        </Field>
      </div>
      <Field label="Also copy at the vendor (optional)" hint="Separate addresses with commas.">
        <input value={cc} onChange={(e) => setCc(e.target.value)} className="input" />
      </Field>
      {error && <p className="text-sm text-rust-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="button" onClick={submit} disabled={saving}
                className="rounded bg-amber-400 px-3.5 py-1.5 text-sm font-medium text-graphite-950 hover:bg-amber-400/90 disabled:opacity-60">
          {saving ? 'Saving…' : vendor ? 'Save vendor' : 'Add vendor'}
        </button>
        <button type="button" onClick={onCancel}
                className="rounded px-3 py-1.5 text-sm text-ink-500 hover:bg-graphite-700 hover:text-ink-300">
          Cancel
        </button>
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
