import { useEffect, useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

const STATUSES = ['active', 'down', 'maintenance', 'retired']

const EMPTY = {
  asset_number: '',
  category_id: '',
  make: '',
  model: '',
  year: '',
  serial_number: '',
  jobsite_id: '',
  crew_id: '',
  status: 'active',
  hour_meter: '',
  odometer: '',
  purchase_date: '',
  purchase_price: '',
  salvage_value: '',
  useful_life_years: '',
  warranty_expiration: '',
  notes: '',
}

export default function AssetDrawer({ asset, categories, jobsites, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [crews, setCrews] = useState([])

  useEffect(() => {
    supabase.from('crews').select('id, name').eq('active', true).order('sort_order')
      .then(({ data }) => setCrews(data || []))
  }, [])

  useEffect(() => {
    if (asset) {
      setForm({
        ...EMPTY,
        ...asset,
        category_id: asset.category_id || '',
        jobsite_id: asset.jobsite_id || '',
        crew_id: asset.crew_id || '',
        year: asset.year ?? '',
        hour_meter: asset.hour_meter ?? '',
        odometer: asset.odometer ?? '',
        purchase_date: asset.purchase_date || '',
        purchase_price: asset.purchase_price ?? '',
        salvage_value: asset.salvage_value ?? '',
        useful_life_years: asset.useful_life_years ?? '',
        warranty_expiration: asset.warranty_expiration || '',
        make: asset.make || '',
        model: asset.model || '',
        serial_number: asset.serial_number || '',
        notes: asset.notes || '',
      })
    } else {
      setForm(EMPTY)
    }
  }, [asset])

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.asset_number.trim()) {
      setError('Asset # is required.')
      return
    }
    setSaving(true)
    setError(null)

    const newHourMeter = form.hour_meter !== '' ? Number(form.hour_meter) : null

    const payload = {
      asset_number: form.asset_number.trim(),
      category_id: form.category_id || null,
      make: form.make.trim() || null,
      model: form.model.trim() || null,
      year: form.year ? Number(form.year) : null,
      serial_number: form.serial_number.trim() || null,
      jobsite_id: form.jobsite_id || null,
      crew_id: form.crew_id || null,
      status: form.status,
      hour_meter: newHourMeter,
      odometer: form.odometer !== '' ? Number(form.odometer) : null,
      purchase_date: form.purchase_date || null,
      purchase_price: form.purchase_price !== '' ? Number(form.purchase_price) : null,
      salvage_value: form.salvage_value !== '' ? Number(form.salvage_value) : null,
      useful_life_years: form.useful_life_years !== '' ? Number(form.useful_life_years) : null,
      warranty_expiration: form.warranty_expiration || null,
      notes: form.notes.trim() || null,
    }

    let assetId = asset?.id
    const query = asset
      ? supabase.from('assets').update(payload).eq('id', asset.id)
      : supabase.from('assets').insert(payload).select().single()

    const { data, error: err } = await query

    if (err) {
      setSaving(false)
      setError(err.message)
      return
    }
    if (!asset && data) assetId = data.id

    // Auto-log a downtime event when status transitions to/from 'down'.
    const prevStatus = asset?.status
    if (assetId && prevStatus !== 'down' && form.status === 'down') {
      await supabase.from('downtime_events').insert({ asset_id: assetId, reason: null })
    } else if (assetId && prevStatus === 'down' && form.status !== 'down') {
      const { data: openEvents } = await supabase
        .from('downtime_events')
        .select('id')
        .eq('asset_id', assetId)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
      if (openEvents && openEvents[0]) {
        await supabase
          .from('downtime_events')
          .update({ ended_at: new Date().toISOString() })
          .eq('id', openEvents[0].id)
      }
    }

    // Auto-log an hour meter reading whenever the value changes.
    const prevHourMeter = asset?.hour_meter ?? null
    if (assetId && newHourMeter != null && newHourMeter !== prevHourMeter) {
      await supabase.from('hour_meter_readings').insert({ asset_id: assetId, hours: newHourMeter })
    }

    setSaving(false)
    onSaved()
  }

  async function handleDelete() {
    if (!asset) return
    if (!window.confirm(`Delete asset ${asset.asset_number}? This can't be undone.`)) return
    setSaving(true)
    const { error: err } = await supabase.from('assets').delete().eq('id', asset.id)
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
            {asset ? `Edit ${asset.asset_number}` : 'Add asset'}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-ink-500 hover:bg-graphite-700 hover:text-ink-100"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <Field label="Asset #" required>
            <input
              value={form.asset_number}
              onChange={(e) => set('asset_number', e.target.value)}
              className="input font-mono"
              placeholder="e.g. 010 - 2025 JD 325G"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select
                value={form.category_id}
                onChange={(e) => set('category_id', e.target.value)}
                className="input"
              >
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
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
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Make">
              <input value={form.make} onChange={(e) => set('make', e.target.value)} className="input" />
            </Field>
            <Field label="Model">
              <input value={form.model} onChange={(e) => set('model', e.target.value)} className="input" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Year">
              <input
                type="number"
                value={form.year}
                onChange={(e) => set('year', e.target.value)}
                className="input font-mono"
              />
            </Field>
            <Field label="Serial #">
              <input
                value={form.serial_number}
                onChange={(e) => set('serial_number', e.target.value)}
                className="input font-mono"
              />
            </Field>
          </div>

          <Field label="Jobsite">
            <select
              value={form.jobsite_id}
              onChange={(e) => set('jobsite_id', e.target.value)}
              className="input"
            >
              <option value="">Unassigned / yard</option>
              {jobsites.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Crew">
            <select value={form.crew_id} onChange={(e) => set('crew_id', e.target.value)} className="input">
              <option value="">Not assigned</option>
              {crews.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} crew
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Hour meter">
              <input
                type="number"
                value={form.hour_meter}
                onChange={(e) => set('hour_meter', e.target.value)}
                readOnly={!!asset?.telematics_asset_id}
                title={asset?.telematics_asset_id ? 'Updated automatically from telematics' : undefined}
                className={`input font-mono ${asset?.telematics_asset_id ? 'cursor-not-allowed opacity-60' : ''}`}
              />
              {asset?.telematics_asset_id && (
                <p className="mt-1 text-xs text-ink-500">Updated automatically from telematics.</p>
              )}
            </Field>
            <Field label="Odometer">
              <input
                type="number"
                value={form.odometer}
                onChange={(e) => set('odometer', e.target.value)}
                className="input font-mono"
              />
            </Field>
          </div>

          <div className="border-t border-graphite-700 pt-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-500">
              Cost & warranty
            </p>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Purchase date">
                  <input
                    type="date"
                    value={form.purchase_date}
                    onChange={(e) => set('purchase_date', e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Purchase price">
                  <input
                    type="number"
                    value={form.purchase_price}
                    onChange={(e) => set('purchase_price', e.target.value)}
                    className="input font-mono"
                    placeholder="0.00"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Useful life (years)">
                  <input
                    type="number"
                    value={form.useful_life_years}
                    onChange={(e) => set('useful_life_years', e.target.value)}
                    className="input font-mono"
                  />
                </Field>
                <Field label="Salvage value">
                  <input
                    type="number"
                    value={form.salvage_value}
                    onChange={(e) => set('salvage_value', e.target.value)}
                    className="input font-mono"
                    placeholder="0.00"
                  />
                </Field>
              </div>
              <Field label="Warranty expiration">
                <input
                  type="date"
                  value={form.warranty_expiration}
                  onChange={(e) => set('warranty_expiration', e.target.value)}
                  className="input"
                />
              </Field>
            </div>
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
            {asset ? (
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
              {saving ? 'Saving…' : asset ? 'Save changes' : 'Add asset'}
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
