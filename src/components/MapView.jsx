import { useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import { divIcon } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Link } from 'react-router-dom'

const CHARLOTTE = [35.2271, -80.8431]

function markerIcon(count) {
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

export default function MapView({ jobsites, assets }) {
  const counts = useMemo(() => {
    const map = {}
    for (const a of assets) {
      if (!a.jobsite_id) continue
      map[a.jobsite_id] = (map[a.jobsite_id] || 0) + 1
    }
    return map
  }, [assets])

  const plottable = jobsites.filter((j) => j.latitude != null && j.longitude != null)

  if (plottable.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="text-ink-300">No jobsites have coordinates yet.</p>
        <p className="mt-1 text-sm text-ink-500">
          Add latitude/longitude to a jobsite on the{' '}
          <Link to="/jobsites" className="text-amber-400 hover:underline">
            Jobsites
          </Link>{' '}
          page to see it here.
        </p>
      </div>
    )
  }

  const center = plottable.length
    ? [
        plottable.reduce((s, j) => s + Number(j.latitude), 0) / plottable.length,
        plottable.reduce((s, j) => s + Number(j.longitude), 0) / plottable.length,
      ]
    : CHARLOTTE

  return (
    <div className="h-full w-full">
      <MapContainer
        center={center}
        zoom={10}
        scrollWheelZoom
        style={{ height: '100%', width: '100%', background: '#15181C' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.esri.com">Esri</a>, HERE, Garmin, FAO, NOAA, USGS'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        />
        {plottable.map((j) => (
          <Marker
            key={j.id}
            position={[Number(j.latitude), Number(j.longitude)]}
            icon={markerIcon(counts[j.id] || 0)}
          >
            <Popup>
              <div style={{ fontFamily: 'Inter, sans-serif' }}>
                <strong>{j.name}</strong>
                <br />
                {counts[j.id] || 0} asset{counts[j.id] === 1 ? '' : 's'}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
