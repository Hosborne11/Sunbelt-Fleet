import { divIcon } from 'leaflet'
import { reportingMeta } from './telematics'

// Machines are small squares so they never read as jobsite counts
export function machineIcon(status) {
  const { hex } = reportingMeta(status)
  return divIcon({
    className: '',
    html: `<div style="width:12px;height:12px;border-radius:3px;background:${hex};
      border:2px solid #101316;box-shadow:0 0 0 1px ${hex}55;"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  })
}
