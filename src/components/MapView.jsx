import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Circle, GeoJSON, useMap } from 'react-leaflet'
import { divIcon, latLngBounds } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Link } from 'react-router-dom'
import { REPORTING, timeAgo, fmtHours } from '../lib/telematics'
import { machineIcon } from '../lib/mapIcons'

const CHARLOTTE = [35.2271, -80.8431]

// maxNativeZoom = deepest zoom the tile service actually has; past that Leaflet stretches those tiles
// instead of requesting tiles that don't exist ("Map data not yet available").
const BASEMAPS = {
  dark: {
    label: 'Dark',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; <a href="https://www.esri.com">Esri</a>, HERE, Garmin, FAO, NOAA, USGS',
    maxNativeZoom: 16,
  },
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
const BASEMAP_KEY = 'fleet.map.basemap'

function jobsiteIcon(count) {
  return divIcon({
    className: '',
    html: `<div style="
      display:flex;align-items:center;justify-content:center;
      width:${count > 0 ? 30 : 22}px;height:${count > 0 ? 30 : 22}px;
      border-radius:9999px;
      background:${count > 0 ? '#F2A93B' : '#4A5158'};
      color:${count > 0 ? '#101316' : '#EEF0F2'};
      font-family:'JetBrains Mono',monospace;font-weight:600;font-size:12px;
      border:2px solid #101316;box-shadow:0 1px 4px rgba(0,0,0,0.4);
    ">${count}</div>`,
    iconSize: count > 0 ? [30, 30] : [22, 22],
    iconAnchor: count > 0 ? [15, 15] : [11, 11],
  })
}


function FitToPoints({ points }) {
  const map = useMap()
  const key = points.map((p) => p.join(',')).join('|')
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 13)
    else if (points.length > 1) map.fitBounds(latLngBounds(points), { padding: [40, 40], maxZoom: 14 })
    // refit only when the set of points changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key])
  return null
}

// Leaflet needs a nudge when its container is resized (e.g. dragging the split divider)
function InvalidateOnResize() {
  const map = useMap()
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(map.getContainer())
    return () => ro.disconnect()
  }, [map])
  return null
}

// Fly to the selected machine and open its popup
function FocusSelected({ selectedId, machines, markerRefs }) {
  const map = useMap()
  useEffect(() => {
    if (!selectedId) return
    const m = machines.find(({ asset }) => asset.id === selectedId)
    if (!m) return
    map.flyTo([Number(m.t.lat), Number(m.t.lng)], Math.max(map.getZoom(), 15), { duration: 0.5 })
    const marker = markerRefs.current[selectedId]
    if (marker) setTimeout(() => marker.openPopup(), 550)
    // only when the selection changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])
  return null
}

export default function MapView({ jobsites, assets, telematics = {}, selectedId = null, onSelect }) {
  const markerRefs = useRef({})
  const [basemap, setBasemap] = useState(() => {
    const saved = window.localStorage.getItem(BASEMAP_KEY)
    return BASEMAPS[saved] ? saved : 'dark'
  })
  useEffect(() => {
    window.localStorage.setItem(BASEMAP_KEY, basemap)
  }, [basemap])
  const bm = BASEMAPS[basemap]
  const counts = useMemo(() => {
    const map = {}
    for (const a of assets) {
      if (!a.jobsite_id) continue
      map[a.jobsite_id] = (map[a.jobsite_id] || 0) + 1
    }
    return map
  }, [assets])

  const plottableSites = useMemo(
    () => jobsites.filter((j) => j.latitude != null && j.longitude != null),
    [jobsites]
  )
  const machines = useMemo(
    () =>
      assets
        .map((a) => ({ asset: a, t: telematics[a.id] }))
        .filter(({ t }) => t && t.lat != null && t.lng != null),
    [assets, telematics]
  )
  const points = useMemo(
    () => [
      ...plottableSites.map((j) => [Number(j.latitude), Number(j.longitude)]),
      ...machines.map(({ t }) => [Number(t.lat), Number(t.lng)]),
    ],
    [plottableSites, machines]
  )

  if (points.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="text-ink-300">Nothing to map yet.</p>
        <p className="mt-1 text-sm text-ink-500">
          Machines appear once they're linked to telematics by serial number. Add coordinates on the{' '}
          <Link to="/jobsites" className="text-amber-400 hover:underline">
            Jobsites
          </Link>{' '}
          page to show job locations.
        </p>
      </div>
    )
  }

  return (
    <div className="relative isolate h-full w-full">
      <MapContainer
        center={CHARLOTTE}
        zoom={10}
        maxZoom={20}
        scrollWheelZoom
        style={{ height: '100%', width: '100%', background: '#15181C' }}
      >
        <TileLayer
          key={basemap}
          attribution={bm.attribution}
          url={bm.url}
          maxNativeZoom={bm.maxNativeZoom}
          maxZoom={20}
        />
        <FitToPoints points={points} />
        <InvalidateOnResize />
        <FocusSelected selectedId={selectedId} machines={machines} markerRefs={markerRefs} />

        {plottableSites.map((j) =>
          j.boundary ? (
            <GeoJSON
              key={`fence-${j.id}-${JSON.stringify(j.boundary)}`}
              data={j.boundary}
              style={() => ({ color: '#F2A93B', weight: 1, opacity: 0.6, fillOpacity: 0.08 })}
            />
          ) : (
            <Circle
              key={`fence-${j.id}`}
              center={[Number(j.latitude), Number(j.longitude)]}
              radius={j.radius_m || 400}
              pathOptions={{ color: '#F2A93B', weight: 1, opacity: 0.5, fillOpacity: 0.06, dashArray: '4 4' }}
            />
          )
        )}

        {plottableSites.map((j) => (
          <Marker
            key={j.id}
            position={[Number(j.latitude), Number(j.longitude)]}
            icon={jobsiteIcon(counts[j.id] || 0)}
          >
            <Popup>
              <div style={{ fontFamily: 'Inter, sans-serif' }}>
                <strong>{j.name}</strong>
                <br />
                {counts[j.id] || 0} asset{counts[j.id] === 1 ? '' : 's'} assigned
              </div>
            </Popup>
          </Marker>
        ))}

        {machines.map(({ asset, t }) => (
          <Marker
            key={`m-${asset.id}`}
            ref={(m) => {
              if (m) markerRefs.current[asset.id] = m
            }}
            position={[Number(t.lat), Number(t.lng)]}
            icon={machineIcon(t.reporting_status, asset.id === selectedId)}
            zIndexOffset={asset.id === selectedId ? 1000 : 0}
            eventHandlers={onSelect ? { click: () => onSelect(asset.id) } : undefined}
          >
            <Popup>
              <div style={{ fontFamily: 'Inter, sans-serif', minWidth: 170 }}>
                <Link to={`/assets/${asset.id}`} style={{ fontWeight: 600 }}>
                  {asset.asset_number}
                </Link>
                <div>{[asset.make, asset.model].filter(Boolean).join(' ')}</div>
                <div style={{ marginTop: 4 }}>
                  {t.current_project ? `On ${t.current_project}` : 'Not inside a jobsite'}
                </div>
                <div>Today: {fmtHours(t.hours_today)}</div>
                <div>Yesterday: {fmtHours(t.hours_yesterday)}</div>
                <div>Last 7 days: {fmtHours(t.hours_7d)}</div>
                <div style={{ color: '#8B939B' }}>Last report {timeAgo(t.location_at)}</div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

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

      <div className="pointer-events-none absolute bottom-4 left-4 z-[1000] rounded border border-graphite-700 bg-graphite-900/90 px-3 py-2 text-xs text-ink-300">
        <div className="mb-1 text-ink-500">Machines by last report</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {['live', 'recent', 'stale', 'offline'].map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-sm ${REPORTING[k].dot}`} />
              {REPORTING[k].label}
            </span>
          ))}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          Jobsite (number = assets assigned)
        </div>
      </div>
    </div>
  )
}
