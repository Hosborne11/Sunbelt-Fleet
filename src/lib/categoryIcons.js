import {
  Truck,
  Container,
  Wrench,
  CircleDot,
  Construction,
  Box,
} from 'lucide-react'

export const ICONS = {
  truck: Truck,
  container: Container,
  wrench: Wrench,
  'circle-dot': CircleDot,
  construction: Construction,
  box: Box,
}

export function iconFor(name) {
  return ICONS[name] || Box
}
