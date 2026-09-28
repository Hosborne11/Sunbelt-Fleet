import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet'
import { divIcon, latLngBounds } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Link } from 'react-router-dom'
import { REPORTING, timeAgo, fmtHours } from '../lib/telematics'
import { machineIcon } from '../lib/mapIcons'

const CHARLOTTE = [35.2271, -80.8431]

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

export default function MapView({ jobsites, assets, telematics = {} }) {
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
    <div className="relative h-full w-full">
      <MapContainer
        center={CHARLOTTE}
        zoom={10}
        scrollWheelZoom
        style={{ height: '100%', width: '100%', background: '#15181C' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.esri.com">Esri</a>, HERE, Garmin, FAO, NOAA, USGS'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        />
        <FitToPoints points={points} />

        {plottableSites.map((j) => (
          <Circle
            key={`fence-${j.id}`}
            center={[Number(j.latitude), Number(j.longitude)]}
            radius={j.radius_m || 400}
            pathOptions={{ color: '#F2A93B', weight: 1, opacity: 0.5, fillOpacity: 0.06 }}
          />
        ))}

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
            position={[Number(t.lat), Number(t.lng)]}
            icon={machineIcon(t.reporting_status)}
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
                <div>Hours today: {fmtHours(t.hours_today)}</div>
                <div style={{ color: '#8B939B' }}>Last report {timeAgo(t.location_at)}</div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

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
