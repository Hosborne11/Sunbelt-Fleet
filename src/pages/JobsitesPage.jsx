import { useEffect, useState } from 'react'
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function JobsitesPage() {
  const [jobsites, setJobsites] = useState([])
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [radius, setRadius] = useState('400')
  const [error, setError] = useState(null)

  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', address: '', latitude: '', longitude: '', radius_m: '' })

  async function load() {
    const { data, error: err } = await supabase.from('jobsites').select('*').order('name')
    if (err) setError(err.message)
    setJobsites(data || [])
  }

  useEffect(() => {
    load()
  }, [])

  async function addJobsite(e) {
    e.preventDefault()
    if (!name.trim()) return
    const { error: err } = await supabase.from('jobsites').insert({
      name: name.trim(),
      address: address.trim() || null,
      latitude: lat !== '' ? Number(lat) : null,
      longitude: lng !== '' ? Number(lng) : null,
      radius_m: radius !== '' ? Number(radius) : 400,
    })
    if (err) {
      setError(err.message)
      return
    }
    setName('')
    setAddress('')
    setLat('')
    setLng('')
    setRadius('400')
    load()
  }

  async function remove(id) {
    if (!window.confirm('Remove this jobsite? Assets assigned to it will become unassigned.')) return
    await supabase.from('jobsites').delete().eq('id', id)
    load()
  }

  function startEdit(j) {
    setEditingId(j.id)
    setEditForm({
      name: j.name || '',
      address: j.address || '',
      latitude: j.latitude ?? '',
      longitude: j.longitude ?? '',
      radius_m: j.radius_m ?? 400,
    })
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function saveEdit(id) {
    if (!editForm.name.trim()) return
    const { error: err } = await supabase
      .from('jobsites')
      .update({
        name: editForm.name.trim(),
        address: editForm.address.trim() || null,
        latitude: editForm.latitude !== '' ? Number(editForm.latitude) : null,
        longitude: editForm.longitude !== '' ? Number(editForm.longitude) : null,
        radius_m: editForm.radius_m !== '' ? Number(editForm.radius_m) : 400,
      })
      .eq('id', id)
    if (err) {
      setError(err.message)
      return
    }
    setEditingId(null)
    load()
  }

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto px-6 py-8">
      <h1 className="text-xl font-semibold text-ink-100">Jobsites</h1>
      <p className="mt-1 text-sm text-ink-500">
        Sites assets can be assigned to — properties, projects, or the yard. Add coordinates to
        plot a jobsite on the Map tab. Coordinates plus a radius also make the jobsite a geofence:
        machines reporting inside it are assigned to it automatically, and their daily hours are
        credited to it.
      </p>

      <form onSubmit={addJobsite} className="mt-6 space-y-2">
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jobsite name"
            className="input flex-1"
          />
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Address (optional)"
            className="input flex-1"
          />
        </div>
        <div className="flex gap-2">
          <input
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            placeholder="Latitude (optional)"
            type="number"
            step="any"
            className="input flex-1 font-mono"
          />
          <input
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            placeholder="Longitude (optional)"
            type="number"
            step="any"
            className="input flex-1 font-mono"
          />
          <input
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
            placeholder="Radius (m)"
            title="Geofence radius in meters"
            type="number"
            min="50"
            step="50"
            className="input w-28 font-mono"
          />
          <button
            type="submit"
            className="flex items-center gap-1.5 whitespace-nowrap rounded bg-amber-400 px-3.5 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
          >
            <Plus size={16} /> Add
          </button>
        </div>
        <p className="text-xs text-ink-500">
          Tip: right-click a location in Google Maps and click the coordinates to copy them.
        </p>
      </form>

      {error && <p className="mt-3 text-sm text-rust-400">{error}</p>}

      <ul className="mt-6 divide-y divide-graphite-800 border-t border-graphite-800">
        {jobsites.map((j) =>
          editingId === j.id ? (
            <li key={j.id} className="space-y-2 py-3">
              <div className="flex gap-2">
                <input
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  className="input flex-1"
                  placeholder="Jobsite name"
                />
                <input
                  value={editForm.address}
                  onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))}
                  className="input flex-1"
                  placeholder="Address"
                />
              </div>
              <div className="flex gap-2">
                <input
                  value={editForm.latitude}
                  onChange={(e) => setEditForm((f) => ({ ...f, latitude: e.target.value }))}
                  type="number"
                  step="any"
                  className="input flex-1 font-mono"
                  placeholder="Latitude"
                />
                <input
                  value={editForm.longitude}
                  onChange={(e) => setEditForm((f) => ({ ...f, longitude: e.target.value }))}
                  type="number"
                  step="any"
                  className="input flex-1 font-mono"
                  placeholder="Longitude"
                />
                <input
                  value={editForm.radius_m}
                  onChange={(e) => setEditForm((f) => ({ ...f, radius_m: e.target.value }))}
                  type="number"
                  min="50"
                  step="50"
                  title="Geofence radius in meters"
                  className="input w-28 font-mono"
                  placeholder="Radius (m)"
                />
                <button
                  onClick={() => saveEdit(j.id)}
                  className="flex items-center gap-1 rounded bg-amber-400 px-3 py-2 text-sm font-medium text-graphite-950 hover:bg-amber-400/90"
                >
                  <Check size={15} />
                </button>
                <button
                  onClick={cancelEdit}
                  className="flex items-center gap-1 rounded border border-graphite-600 px-3 py-2 text-sm text-ink-300 hover:bg-graphite-700"
                >
                  <X size={15} />
                </button>
              </div>
            </li>
          ) : (
            <li key={j.id} className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm text-ink-100">{j.name}</div>
                {j.address && <div className="text-xs text-ink-500">{j.address}</div>}
                {j.latitude != null && j.longitude != null && (
                  <div className="font-mono text-xs text-ink-500">
                    {Number(j.latitude).toFixed(4)}, {Number(j.longitude).toFixed(4)}, {j.radius_m ?? 400} m
                    geofence
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => startEdit(j)}
                  className="rounded p-1.5 text-ink-500 hover:bg-graphite-700 hover:text-ink-100"
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => remove(j.id)}
                  className="rounded p-1.5 text-ink-500 hover:bg-rust-500/10 hover:text-rust-400"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          )
        )}
        {jobsites.length === 0 && (
          <li className="py-6 text-center text-sm text-ink-500">No jobsites yet.</li>
        )}
      </ul>
    </div>
  )
}
