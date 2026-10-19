import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, MapPin, PenLine, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchTelematicsByAsset } from '../lib/telematics'
import { boundaryAcres, boundaryCentroid } from '../lib/geo'
import GeofenceMap from '../components/GeofenceMap'

const EMPTY_FORM = { name: '', job_number: '', address: '', radius_m: '400', active: true }
const EMPTY_DRAFT = { boundary: null, center: null, radius_m: 400 }

const MODE_HINTS = {
  draw: 'Click the map to place each corner. Click the first corner again to close the shape. Esc cancels.',
  edit: 'Drag corners to move them, drag a midpoint to add a corner, right-click a corner to remove it.',
  pin: "Click the map at the jobsite's center. Esc cancels.",
}

function focusFor(j, key) {
  if (j.boundary) {
    const polys = j.boundary.type === 'MultiPolygon' ? j.boundary.coordinates : [j.boundary.coordinates]
    const bounds = polys.flatMap((p) => (p[0] || []).map(([lng, lat]) => [lat, lng]))
    return { key, bounds }
  }
  if (j.latitude != null && j.longitude != null) {
    return { key, center: [Number(j.latitude), Number(j.longitude)], zoom: 16 }
  }
  return null
}

function geofenceSummary(draft) {
  if (draft.boundary) {
    const acres = boundaryAcres(draft.boundary)
    return `Drawn boundary${acres ? `, about ${acres < 10 ? acres.toFixed(1) : Math.round(acres)} acres` : ''}`
  }
  if (draft.center) return `${draft.radius_m || 400} m circle around a pin`
  return 'No geofence yet'
}

export default function JobsitesPage() {
  const [jobsites, setJobsites] = useState([])
  const [assets, setAssets] = useState([])
  const [telematics, setTelematics] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const [selectedId, setSelectedId] = useState(null) // null | 'new' | jobsite id
  const [form, setForm] = useState(EMPTY_FORM)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [mode, setMode] = useState('idle') // idle | draw | edit | pin
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [focus, setFocus] = useState(null)

  const [filter, setFilter] = useState('')
  const [showCompleted, setShowCompleted] = useState(false)

  const load = useCallback(async () => {
    const [jRes, aRes, tRes] = await Promise.all([
      supabase.from('jobsites').select('*').order('name'),
      supabase.from('assets').select('id, asset_number'),
      fetchTelematicsByAsset(),
    ])
    if (jRes.error) setLoadError(jRes.error.message)
    setJobsites(jRes.data || [])
    setAssets(aRes.data || [])
    setTelematics(tRes.map)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Machines with a current position, and who is inside each jobsite right now
  const machines = useMemo(
    () =>
      assets
        .map((a) => ({ a, t: telematics[a.id] }))
        .filter(({ t }) => t && t.lat != null && t.lng != null)
        .map(({ a, t }) => ({ id: a.id, label: a.asset_number, lat: Number(t.lat), lng: Number(t.lng), status: t.reporting_status })),
    [assets, telematics]
  )
  const onSite = useMemo(() => {
    const m = {}
    for (const a of assets) {
      const pid = telematics[a.id]?.current_project_id
      if (pid) (m[pid] ||= []).push(a.asset_number)
    }
    return m
  }, [assets, telematics])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return jobsites.filter(
      (j) =>
        (showCompleted || j.active) &&
        (!q || [j.name, j.job_number, j.address].filter(Boolean).join(' ').toLowerCase().includes(q))
    )
  }, [jobsites, filter, showCompleted])

  function confirmDiscard() {
    return !dirty || window.confirm('Discard your unsaved changes to this jobsite?')
  }

  function openJobsite(id) {
    const j = jobsites.find((x) => x.id === id)
    if (!j || !confirmDiscard()) return
    setSelectedId(j.id)
    setForm({
      name: j.name || '',
      job_number: j.job_number || '',
      address: j.address || '',
      radius_m: String(j.radius_m ?? 400),
      active: j.active,
    })
    setDraft({
      boundary: j.boundary || null,
      center: j.latitude != null ? [Number(j.latitude), Number(j.longitude)] : null,
      radius_m: j.radius_m ?? 400,
    })
    setMode('idle')
    setDirty(false)
    setError(null)
    setNotice(null)
    setFocus(focusFor(j, Date.now()))
  }

  function openNew() {
    if (!confirmDiscard()) return
    setSelectedId('new')
    setForm(EMPTY_FORM)
    setDraft(EMPTY_DRAFT)
    setMode('idle')
    setDirty(false)
    setError(null)
    setNotice(null)
  }

  function closeDetail() {
    if (!confirmDiscard()) return
    setSelectedId(null)
    setMode('idle')
    setDirty(false)
    setError(null)
    setNotice(null)
  }

  const setField = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }))
    if (field === 'radius_m') setDraft((d) => ({ ...d, radius_m: Number(value) || 400 }))
    setDirty(true)
  }
  const updateDraft = useCallback((partial) => {
    setDraft((d) => ({ ...d, ...partial }))
    setDirty(true)
  }, [])

  function onAddressPicked(r) {
    setFocus({ key: Date.now(), center: [r.lat, r.lng], zoom: 17 })
    if (selectedId && !form.address && r.short) setField('address', r.short)
  }

  async function save() {
    if (!form.name.trim()) {
      setError('Give the jobsite a name before saving.')
      return
    }
    const center = draft.boundary ? boundaryCentroid(draft.boundary) : draft.center
    const payload = {
      name: form.name.trim(),
      job_number: form.job_number.trim() || null,
      address: form.address.trim() || null,
      active: form.active,
      radius_m: Number(form.radius_m) || 400,
      boundary: draft.boundary || null,
      latitude: center ? center[0] : null,
      longitude: center ? center[1] : null,
    }
    setSaving(true)
    setError(null)
    const res =
      selectedId === 'new'
        ? await supabase.from('jobsites').insert(payload).select().single()
        : await supabase.from('jobsites').update(payload).eq('id', selectedId).select().single()
    setSaving(false)
    if (res.error) {
      setError(
        res.error.code === '23505' && /job_number/.test(res.error.message)
          ? `Job # ${payload.job_number} is already used by another jobsite.`
          : res.error.message
      )
      return
    }
    setMode('idle')
    setDirty(false)
    setSelectedId(res.data.id)
    setNotice('Saved. Machine hours credited to this jobsite update within 5 minutes.')
    load()
  }

  async function remove() {
    if (
      !window.confirm(
        `Delete ${form.name || 'this jobsite'}? Machines on it become unassigned, and past days credited to it lose their jobsite. To keep its history, uncheck "Active job" instead.`
      )
    )
      return
    const { error: err } = await supabase.from('jobsites').delete().eq('id', selectedId)
    if (err) {
      setError(err.message)
      return
    }
    setDirty(false)
    setSelectedId(null)
    load()
  }

  const mapJobsites = selectedId ? jobsites.filter((j) => j.active || j.id === selectedId) : visible

  return (
    <div className="flex h-full">
      <aside className="flex w-[360px] shrink-0 flex-col border-r border-graphite-700 bg-graphite-900">
        {selectedId ? (
          <DetailPanel
            isNew={selectedId === 'new'}
            form={form}
            draft={draft}
            mode={mode}
            onSite={selectedId !== 'new' ? onSite[selectedId] || [] : []}
            saving={saving}
            dirty={dirty}
            error={error}
            notice={notice}
            setField={setField}
            setMode={setMode}
            clearBoundary={() => updateDraft({ boundary: null })}
            onBack={closeDetail}
            onSave={save}
            onDelete={remove}
          />
        ) : (
          <ListPanel
            loading={loading}
            loadError={loadError}
            jobsites={visible}
            total={jobsites.length}
            onSite={onSite}
            filter={filter}
            setFilter={setFilter}
            showCompleted={showCompleted}
            setShowCompleted={setShowCompleted}
            onOpen={openJobsite}
            onNew={openNew}
          />
        )}
      </aside>

      <div className="relative flex-1">
        <GeofenceMap
          jobsites={mapJobsites}
          selectedId={selectedId}
          draft={draft}
          mode={mode}
          onDraftChange={updateDraft}
          onModeChange={setMode}
          onSelect={openJobsite}
          onAddressPicked={onAddressPicked}
          machines={machines}
          focus={focus}
        />
        {mode !== 'idle' && (
          <div className="absolute bottom-6 left-1/2 z-[1000] flex max-w-xl -translate-x-1/2 items-center gap-3 rounded border border-graphite-600 bg-graphite-900/95 px-4 py-2.5 text-sm text-ink-300 shadow-lg">
            <span>{MODE_HINTS[mode]}</span>
            {mode === 'edit' ? (
              <button
                onClick={() => setMode('idle')}
                className="flex shrink-0 items-center gap-1 rounded bg-amber-400 px-2.5 py-1 font-medium text-graphite-950 hover:bg-amber-400/90"
              >
                <Check size={14} /> Done
              </button>
            ) : (
              <button
                onClick={() => setMode('idle')}
                className="flex shrink-0 items-center gap-1 rounded border border-graphite-600 px-2.5 py-1 text-ink-300 hover:bg-graphite-700"
              >
                <X size={14} /> Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ListPanel({ loading, loadError, jobsites, total, onSite, filter, setFilter, showCompleted, setShowCompleted, onOpen, onNew }) {
  return (
    <>
      <div className="border-b border-graphite-700 px-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-ink-100">Jobsites</h1>
            <p className="text-xs text-ink-500">{loading ? 'Loading…' : `${jobsites.length} of ${total}`}</p>
          </div>
          <button
            onClick={onNew}
            className="flex items-center gap-1.5 rounded bg-amber-400 px-3 py-1.5 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
          >
            <Plus size={15} /> New jobsite
          </button>
        </div>
        <div className="relative mt-3">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search name, job #, address"
            className="w-full rounded border border-graphite-600 bg-graphite-900 py-1.5 pl-8 pr-3 text-sm text-ink-100 outline-none placeholder:text-ink-500 focus:border-amber-400/60"
          />
        </div>
        <label className="mt-2.5 flex items-center gap-2 text-xs text-ink-500">
          <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />
          Show completed jobs
        </label>
      </div>

      {loadError && <p className="px-4 py-3 text-sm text-rust-400">{loadError}</p>}

      <ul className="flex-1 overflow-y-auto">
        {jobsites.map((j) => {
          const here = onSite[j.id] || []
          return (
            <li key={j.id}>
              <button
                onClick={() => onOpen(j.id)}
                className="block w-full border-b border-graphite-800 px-4 py-3 text-left hover:bg-graphite-800/60"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm text-ink-100">{j.name}</span>
                  {j.job_number && <span className="shrink-0 font-mono text-xs text-ink-500">{j.job_number}</span>}
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 text-xs">
                  <span className={j.boundary || j.latitude != null ? 'text-ink-500' : 'text-amber-400'}>
                    {j.boundary ? 'Drawn boundary' : j.latitude != null ? `${j.radius_m ?? 400} m circle` : 'No geofence yet'}
                    {!j.active && ', completed'}
                  </span>
                  {here.length > 0 && <span className="shrink-0 text-teal-400">{here.length} on site now</span>}
                </div>
              </button>
            </li>
          )
        })}
        {!loading && jobsites.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-ink-500">
            {total === 0 ? 'No jobsites yet. Add one, then draw its boundary on the map.' : 'No jobsites match.'}
          </li>
        )}
      </ul>
    </>
  )
}

function DetailPanel({ isNew, form, draft, mode, onSite, saving, dirty, error, notice, setField, setMode, clearBoundary, onBack, onSave, onDelete }) {
  const busy = mode !== 'idle'
  return (
    <>
      <div className="border-b border-graphite-700 px-4 py-4">
        <button onClick={onBack} className="mb-2 flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-100">
          <ArrowLeft size={15} /> All jobsites
        </button>
        <h1 className="truncate text-lg font-semibold text-ink-100">{isNew ? 'New jobsite' : form.name || 'Untitled jobsite'}</h1>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <Field label="Name" required>
          <input value={form.name} onChange={(e) => setField('name', e.target.value)} className="input" placeholder="e.g. Riley Ave" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Job #">
            <input value={form.job_number} onChange={(e) => setField('job_number', e.target.value)} className="input font-mono" />
          </Field>
          <div>
            <span className="mb-1 block text-sm text-ink-300">Status</span>
            <label className="flex h-[38px] items-center gap-2 text-sm text-ink-300">
              <input type="checkbox" checked={form.active} onChange={(e) => setField('active', e.target.checked)} />
              Active job
            </label>
          </div>
        </div>
        <Field label="Address">
          <input value={form.address} onChange={(e) => setField('address', e.target.value)} className="input" />
        </Field>

        <div className="rounded border border-graphite-700 bg-graphite-800/40 p-3">
          <div className="text-sm font-medium text-ink-100">Geofence</div>
          <p className={`mt-0.5 text-sm ${draft.boundary || draft.center ? 'text-ink-300' : 'text-amber-400'}`}>
            {geofenceSummary(draft)}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Machines reporting inside it are assigned to this jobsite, and their daily hours are credited to it.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {draft.boundary ? (
              <>
                <ToolButton icon={Pencil} onClick={() => setMode('edit')} disabled={busy}>Edit shape</ToolButton>
                <ToolButton icon={PenLine} onClick={() => setMode('draw')} disabled={busy}>Redraw</ToolButton>
                <ToolButton icon={Trash2} onClick={clearBoundary} disabled={busy} tone="rust">Remove</ToolButton>
              </>
            ) : (
              <>
                <ToolButton icon={PenLine} onClick={() => setMode('draw')} disabled={busy} primary>Draw boundary</ToolButton>
                <ToolButton icon={MapPin} onClick={() => setMode('pin')} disabled={busy}>
                  {draft.center ? 'Move pin' : 'Drop a pin'}
                </ToolButton>
              </>
            )}
          </div>

          {!draft.boundary && draft.center && (
            <div className="mt-3">
              <Field label="Circle radius (meters)">
                <input
                  type="number"
                  min="50"
                  step="50"
                  value={form.radius_m}
                  onChange={(e) => setField('radius_m', e.target.value)}
                  className="input font-mono"
                />
              </Field>
            </div>
          )}
        </div>

        {!isNew && (
          <div>
            <div className="text-sm font-medium text-ink-100">On site now</div>
            <p className="mt-0.5 text-sm text-ink-300">
              {onSite.length ? onSite.join(', ') : 'No machines are reporting inside this geofence.'}
            </p>
          </div>
        )}

        {error && <p className="text-sm text-rust-400">{error}</p>}
        {notice && !dirty && <p className="text-sm text-teal-400">{notice}</p>}
      </div>

      <div className="flex items-center gap-2 border-t border-graphite-700 px-4 py-3">
        <button
          onClick={onSave}
          disabled={saving || busy || (!dirty && !isNew)}
          className="rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : isNew ? 'Create jobsite' : 'Save changes'}
        </button>
        <button onClick={onBack} className="rounded border border-graphite-600 px-3.5 py-2 text-sm text-ink-300 hover:bg-graphite-700">
          Cancel
        </button>
        {!isNew && (
          <button
            onClick={onDelete}
            className="ml-auto rounded p-2 text-ink-500 hover:bg-rust-500/10 hover:text-rust-400"
            title="Delete jobsite"
            aria-label="Delete jobsite"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </>
  )
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-ink-300">
        {label}
        {required && <span className="text-amber-400"> *</span>}
      </span>
      {children}
    </label>
  )
}

function ToolButton({ icon: Icon, children, onClick, disabled, primary, tone }) {
  const cls = primary
    ? 'bg-amber-400 font-medium text-graphite-950 hover:bg-amber-400/90'
    : tone === 'rust'
      ? 'border border-graphite-600 text-ink-300 hover:bg-rust-500/10 hover:text-rust-400'
      : 'border border-graphite-600 text-ink-300 hover:bg-graphite-700'
  return (
    <button onClick={onClick} disabled={disabled} className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm disabled:opacity-50 ${cls}`}>
      <Icon size={14} strokeWidth={1.75} /> {children}
    </button>
  )
}
