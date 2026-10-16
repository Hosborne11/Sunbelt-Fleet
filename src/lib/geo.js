// Area-weighted centroid of a GeoJSON Polygon/MultiPolygon, returned as [lat, lng]
export function boundaryCentroid(geometry) {
  if (!geometry) return null
  const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]
  let a = 0, cx = 0, cy = 0
  for (const poly of polys) {
    const ring = poly[0] || []
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i]
      const [x1, y1] = ring[i + 1]
      const f = x0 * y1 - x1 * y0
      a += f
      cx += (x0 + x1) * f
      cy += (y0 + y1) * f
    }
  }
  if (Math.abs(a) < 1e-12) {
    const pts = polys.flatMap((p) => p[0] || [])
    if (!pts.length) return null
    return [pts.reduce((s, p) => s + p[1], 0) / pts.length, pts.reduce((s, p) => s + p[0], 0) / pts.length]
  }
  a *= 0.5
  return [cy / (6 * a), cx / (6 * a)]
}

// Approximate area of a boundary in acres (for a sanity check while drawing)
export function boundaryAcres(geometry) {
  if (!geometry) return null
  const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]
  const R = 6378137
  let m2 = 0
  for (const poly of polys) {
    const ring = poly[0] || []
    let s = 0
    for (let i = 0; i < ring.length - 1; i++) {
      const [lng0, lat0] = ring[i]
      const [lng1, lat1] = ring[i + 1]
      s += ((lng1 - lng0) * Math.PI) / 180 * (2 + Math.sin((lat0 * Math.PI) / 180) + Math.sin((lat1 * Math.PI) / 180))
    }
    m2 += Math.abs((s * R * R) / 2)
  }
  return m2 / 4046.8564
}

// "35.1234, -80.5678" -> [35.1234, -80.5678]
export function parseCoords(text) {
  const m = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1]), lng = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null
}

// Address search (OpenStreetMap Nominatim), biased to the Charlotte region
export async function searchAddress(query) {
  const coords = parseCoords(query)
  if (coords) return [{ label: `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`, short: '', lat: coords[0], lng: coords[1] }]
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    addressdetails: '1',
    limit: '5',
    countrycodes: 'us',
    viewbox: '-81.9,35.9,-79.9,34.4',
  })
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Address search failed (${res.status})`)
  const rows = await res.json()
  return rows.map((r) => {
    const a = r.address || {}
    const street = [a.house_number, a.road].filter(Boolean).join(' ')
    const town = a.city || a.town || a.village || a.hamlet || a.county || ''
    return {
      label: r.display_name,
      short: [street, town, a.state].filter(Boolean).join(', '),
      lat: Number(r.lat),
      lng: Number(r.lon),
    }
  })
}
