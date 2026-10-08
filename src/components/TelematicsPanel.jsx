import { useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Polyline } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { Radio } from 'lucide-react'
import { machineIcon } from '../lib/mapIcons'
import { reportingMeta, timeAgo, fmtHours, fmtPct } from '../lib/telematics'

// Live telematics for one machine: current metrics, recent trail, daily usage.
export default function TelematicsPanel({ asset, telematics, usage, trail }) {
  if (asset.status === 'retired' && asset.telematics_asset_id) {
    return (
      <div className="rounded border border-graphite-700 bg-graphite-800/40">
        <div className="flex items-center gap-2 border-b border-graphite-700 px-4 py-3 text-sm font-semibold text-ink-100">
          <Radio size={16} strokeWidth={1.75} className="text-ink-500" />
          Telematics <span className="font-normal text-ink-500">(retired: live tracking stopped)</span>
        </div>
        <UsageTable usage={usage} />
      </div>
    )
  }
  if (!asset.telematics_asset_id || !telematics) {
    return (
      <div className="rounded border border-graphite-700 bg-graphite-800/40 px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink-100">
          <Radio size={16} strokeWidth={1.75} className="text-ink-500" />
          Telematics
        </div>
        <p className="mt-1.5 text-sm text-ink-500">
          Not linked. A machine links automatically when its serial number matches a John Deere or
          Hitachi unit — the full PIN or just the last digits both work.
        </p>
      </div>
    )
  }

  const meta = reportingMeta(telematics.reporting_status)
  const idlePct =
    telematics.hours_today > 0 && telematics.idle_hours_today != null
      ? (100 * telematics.idle_hours_today) / telematics.hours_today
      : null

  return (
    <div className="rounded border border-graphite-700 bg-graphite-800/40">
      <div className="flex items-center justify-between border-b border-graphite-700 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink-100">
          <Radio size={16} strokeWidth={1.75} className="text-ink-500" />
          Telematics
          <span className="font-normal capitalize text-ink-500">({telematics.source_code})</span>
        </div>
        <div className={`flex items-center gap-1.5 text-xs ${meta.text}`}>
          <span className={`h-2 w-2 rounded-sm ${meta.dot}`} />
          {meta.label}, last report {timeAgo(telematics.last_report_at)}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-5">
        <div className="grid grid-cols-2 content-start gap-3 lg:col-span-2">
          <Stat label="Current jobsite" value={telematics.current_project || 'Not inside a jobsite'} />
          <Stat label="Hours today" value={fmtHours(telematics.hours_today)} />
          <Stat label="Last 7 days" value={fmtHours(telematics.hours_7d)} />
          <Stat label="Idle today" value={idlePct != null ? fmtPct(idlePct) : '—'} />
          <Stat label="Fuel level" value={fmtPct(telematics.fuel_remaining_pct)} />
          <Stat label="DEF level" value={fmtPct(telematics.def_remaining_pct)} />
          <Stat
            label="Open fault codes (7 days)"
            value={telematics.open_faults_7d || 'None'}
            tone={telematics.open_faults_7d ? 'rust' : undefined}
          />
          <Stat label="Hour meter" value={fmtHours(telematics.operating_hours, 1)} />
        </div>
        <div className="lg:col-span-3">
          <TrailMap telematics={telematics} trail={trail} />
        </div>
      </div>

      <UsageTable usage={usage} />
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className="rounded border border-graphite-700 bg-graphite-800 px-3 py-2.5">
      <div className={`truncate text-sm font-semibold ${tone === 'rust' ? 'text-rust-400' : 'text-ink-100'}`}>
        {value}
      </div>
      <div className="text-xs text-ink-500">{label}</div>
    </div>
  )
}

function TrailMap({ telematics, trail }) {
  const line = useMemo(() => trail.map((p) => [Number(p.lat), Number(p.lng)]), [trail])
  const here =
    telematics.lat != null ? [Number(telematics.lat), Number(telematics.lng)] : line[line.length - 1]

  if (!here) {
    return (
      <div className="flex h-64 items-center justify-center rounded border border-graphite-700 text-sm text-ink-500">
        No location reported yet.
      </div>
    )
  }

  return (
    <div className="isolate h-64 overflow-hidden rounded border border-graphite-700">
      <MapContainer
        center={here}
        zoom={14}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%', background: '#15181C' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.esri.com">Esri</a>'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        />
        {line.length > 1 && (
          <Polyline positions={line} pathOptions={{ color: '#3FA796', weight: 2, opacity: 0.7 }} />
        )}
        <Marker position={here} icon={machineIcon(telematics.reporting_status)} />
      </MapContainer>
    </div>
  )
}

function UsageTable({ usage }) {
  return (
    <div className="border-t border-graphite-700">
      <div className="px-4 pb-1 pt-3 text-sm font-semibold text-ink-100">
        Daily usage <span className="font-normal text-ink-500">(last {usage.length} days reported)</span>
      </div>
      {usage.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-ink-500">No daily readings yet.</p>
      ) : (
        <div className="max-h-72 overflow-y-auto px-4 pb-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-500">
                <th className="py-1.5 font-medium">Date</th>
                <th className="py-1.5 text-right font-medium">Hours</th>
                <th className="py-1.5 text-right font-medium">Idle</th>
                <th className="py-1.5 text-right font-medium">Fuel (gal)</th>
                <th className="py-1.5 pl-4 font-medium">Jobsite</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.reading_date} className="border-t border-graphite-800">
                  <td className="py-1.5 text-ink-100">{u.reading_date}</td>
                  <td className="py-1.5 text-right font-mono text-ink-300">
                    {u.hours_used != null ? Number(u.hours_used).toFixed(1) : '—'}
                  </td>
                  <td className="py-1.5 text-right font-mono text-ink-500">
                    {u.idle_pct != null ? `${Math.round(u.idle_pct)}%` : '—'}
                  </td>
                  <td className="py-1.5 text-right font-mono text-ink-500">
                    {u.fuel_used_gal != null ? Number(u.fuel_used_gal).toFixed(1) : '—'}
                  </td>
                  <td className="truncate py-1.5 pl-4 text-ink-300">{u.project_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
