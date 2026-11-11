import { divIcon } from 'leaflet'
import { reportingMeta } from './telematics'

// Machines are small squares so they never read as jobsite counts; the selected one gets a white ring
export function machineIcon(status, selected = false) {
  const { hex } = reportingMeta(status)
  const size = selected ? 16 : 12
  return divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:3px;background:${hex};
      border:2px solid ${selected ? '#EEF0F2' : '#101316'};
      box-shadow:0 0 0 ${selected ? 3 : 1}px ${selected ? 'rgba(242,169,59,0.55)' : hex + '55'};"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}
