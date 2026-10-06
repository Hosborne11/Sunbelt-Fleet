import L from 'leaflet' // must load before Geoman, which patches the global L
import '@geoman-io/leaflet-geoman-free'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, GeoJSON, Circle, Marker, Tooltip, useMap } from 'react-leaflet'
import { Search, X } from 'lucide-react'
import { machineIcon } from '../lib/mapIcons'
import { searchAddress } from '../lib/geo'

const CHARLOTTE = [35.2271, -80.8431]
const AMBER = '#F2A93B'

const BASEMAPS = {
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, Maxar, Earthstar Geographics',
    maxNativeZoom: 19,
  },
  streets: {
    label: 'Streets',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, HERE, Garmin, USGS',
    maxNativeZoom: 19,
  },
}

const SHAPE_STYLE = { color: AMBER, weight: 1.5, opacity: 0.8, fillOpacity: 0.12 }
const SELECTED_STYLE = { color: AMBER, weight: 3, opacity: 1, fillOpacity: 0.22, dashArray: null }

// Props:
//  jobsites        – all jobsites to show (selected one is drawn from `draft` instead)
//  selectedId      – jobsite being edited ('new' for a new one), or null
//  draft           – { boundary: GeoJSON | null, center: [lat,lng] | null, radius_m }
//  mode            – 'idle' | 'draw' | 'edit' | 'pin'
//  onDraftChange   – (partialDraft) => void
//  onModeChange    – (mode) => void
//  onSelect        – (jobsiteId) => void   (click a shape while nothing is selected)
//  onAddressPicked – (result) => void      (address search result chosen)
//  machines        – [{ id, label, lat, lng, status }]
//  focus           – { key, bounds?: [[lat,lng]...], center?: [lat,lng], zoom? } to move the map
export default function GeofenceMap({
  jobsites, selectedId, draft, mode, onDraftChange, onModeChange, onSelect, onAddressPicked, machines, focus,
}) {
  const [basemap, setBasemap] = useState('satellite')
  const bm = BASEMAPS[basemap]

  return (
    <div className={`relative isolate h-full w-full ${mode === 'pin' || mode === 'draw' ? 'cursor-crosshair' : ''}`}>
      <MapContainer
        center={CHARLOTTE}
        zoom={11}
        maxZoom={21}
        scrollWheelZoom
        style={{ height: '100%', width: '100%', background: '#15181C' }}
      >
        <TileLayer key={basemap} url={bm.url} attribution={bm.attribution} maxNativeZoom={bm.maxNativeZoom} maxZoom={21} />
        <FocusController focus={focus} />
        <DrawController mode={mode} draft={draft} selectedId={selectedId}
                        onDraftChange={onDraftChange} onModeChange={onModeChange} />

        {jobsites
          .filter((j) => j.id !== selectedId)
          .map((j) => (
            <JobsiteShape key={`${j.id}-${JSON.stringify(j.boundary)}-${j.latitude}-${j.longitude}-${j.radius_m}`} jobsite={j} style={SHAPE_STYLE}
                          onClick={selectedId ? undefined : () => onSelect(j.id)} />
          ))}

        {selectedId && mode !== 'edit' && (
          <JobsiteShape
            key={`selected-${JSON.stringify(draft.boundary)}-${draft.center}-${draft.radius_m}`}
            jobsite={{
              boundary: draft.boundary,
              latitude: draft.center?.[0],
              longitude: draft.center?.[1],
              radius_m: draft.radius_m,
            }}
            style={SELECTED_STYLE}
          />
        )}

        {machines.map((m) => (
          <Marker key={m.id} position={[m.lat, m.lng]} icon={machineIcon(m.status)} interactive>
            <Tooltip direction="top" offset={[0, -6]}>{m.label}</Tooltip>
          </Marker>
        ))}
      </MapContainer>

      <AddressSearch onPick={onAddressPicked} />

      <div className="absolute right-3 top-3 z-[1000] flex rounded border border-graphite-700 bg-graphite-900/95 p-0.5 text-xs">
        {Object.entries(BASEMAPS).map(([k, v]) => (
          <button
            key={k}
            onClick={() => setBasemap(k)}
            className={`rounded px-2.5 py-1 ${basemap === k ? 'bg-amber-400 font-medium text-graphite-950' : 'text-ink-300 hover:text-ink-100'}`}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function JobsiteShape({ jobsite, style, onClick }) {
  const handlers = onClick ? { click: onClick } : undefined
  if (jobsite.boundary) {
    return (
      <GeoJSON data={jobsite.boundary} style={() => style} eventHandlers={handlers}>
        {jobsite.name && <Tooltip sticky>{jobsite.name}</Tooltip>}
      </GeoJSON>
    )
  }
  if (jobsite.latitude != null && jobsite.longitude != null) {
    return (
      <Circle
        center={[Number(jobsite.latitude), Number(jobsite.longitude)]}
        radius={Number(jobsite.radius_m) || 400}
        pathOptions={{ ...style, dashArray: '4 4' }}
        eventHandlers={handlers}
      >
        {jobsite.name && <Tooltip sticky>{jobsite.name}</Tooltip>}
      </Circle>
    )
  }
  return null
}

function FocusController({ focus }) {
  const map = useMap()
  useEffect(() => {
    if (!focus) return
    if (focus.bounds && focus.bounds.length > 1) {
      map.fitBounds(L.latLngBounds(focus.bounds), { padding: [60, 60], maxZoom: 18 })
    } else if (focus.center) {
      map.flyTo(focus.center, focus.zoom || 17, { duration: 0.6 })
    }
    // move only when a new focus request arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, focus?.key])
  return null
}

// Drawing and editing run imperatively through Geoman; React state only receives the result.
function DrawController({ mode, draft, selectedId, onDraftChange, onModeChange }) {
  const map = useMap()
  const draftRef = useRef(draft)
  const cbRef = useRef({ onDraftChange, onModeChange })
  // keep refs current; declared before the effect below so it always sees fresh values
  useEffect(() => {
    draftRef.current = draft
    cbRef.current = { onDraftChange, onModeChange }
  })

  useEffect(() => {
    if (!map.pm) return undefined

    if (mode === 'draw') {
      map.pm.enableDraw('Polygon', {
        snappable: false,
        allowSelfIntersection: false,
        templineStyle: { color: AMBER },
        hintlineStyle: { color: AMBER, dashArray: [4, 4] },
        pathOptions: SELECTED_STYLE,
      })
      const onCreate = (e) => {
        const geometry = e.layer.toGeoJSON().geometry
        map.removeLayer(e.layer)
        cbRef.current.onDraftChange({ boundary: geometry })
        cbRef.current.onModeChange('idle')
      }
      map.on('pm:create', onCreate)
      return () => {
        map.off('pm:create', onCreate)
        map.pm.disableDraw()
      }
    }

    if (mode === 'edit' && draftRef.current.boundary) {
      const group = L.geoJSON(draftRef.current.boundary, { style: () => SELECTED_STYLE })
      const layers = group.getLayers()
      group.addTo(map)
      const push = () => {
        const polys = layers.map((l) => l.toGeoJSON().geometry)
        const geometry =
          polys.length === 1
            ? polys[0]
            : { type: 'MultiPolygon', coordinates: polys.flatMap((g) => (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates])) }
        cbRef.current.onDraftChange({ boundary: geometry })
      }
      for (const l of layers) {
        l.pm.enable({ allowSelfIntersection: false, snappable: false })
        l.on('pm:edit', push)
      }
      return () => {
        for (const l of layers) {
          l.off('pm:edit', push)
          l.pm.disable()
        }
        map.removeLayer(group)
      }
    }

    if (mode === 'pin') {
      const onClick = (e) => {
        cbRef.current.onDraftChange({ center: [e.latlng.lat, e.latlng.lng] })
        cbRef.current.onModeChange('idle')
      }
      map.on('click', onClick)
      return () => map.off('click', onClick)
    }

    return undefined
    // re-run only when the mode or the jobsite being edited changes
  }, [map, mode, selectedId])

  // Esc cancels drawing / pin placement
  useEffect(() => {
    if (mode !== 'draw' && mode !== 'pin') return undefined
    const onKey = (e) => e.key === 'Escape' && cbRef.current.onModeChange('idle')
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode])

  return null
}

function AddressSearch({ onPick }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function run(e) {
    e.preventDefault()
    if (!q.trim()) return
    setBusy(true)
    setError(null)
    try {
      const r = await searchAddress(q)
      setResults(r)
      if (r.length === 0) setError('No matches. Try a street address, or paste coordinates.')
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  return (
    <div className="absolute left-14 top-3 z-[1000] w-80">
      <form onSubmit={run} className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={busy ? 'Searching…' : 'Find an address or paste coordinates'}
          className="w-full rounded border border-graphite-600 bg-graphite-900/95 py-2 pl-8 pr-8 text-sm text-ink-100 outline-none placeholder:text-ink-500 focus:border-amber-400/60"
        />
        {(q || results.length > 0) && (
          <button
            type="button"
            onClick={() => { setQ(''); setResults([]); setError(null) }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-500 hover:text-ink-100"
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </form>
      {(results.length > 0 || error) && (
        <div className="mt-1 overflow-hidden rounded border border-graphite-700 bg-graphite-900/95 text-sm">
          {error && <div className="px-3 py-2 text-ink-500">{error}</div>}
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => { onPick(r); setResults([]) }}
              className="block w-full truncate border-b border-graphite-800 px-3 py-2 text-left text-ink-300 last:border-b-0 hover:bg-graphite-800 hover:text-ink-100"
              title={r.label}
            >
              {r.short || r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
