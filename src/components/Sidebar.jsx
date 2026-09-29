import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  LayoutGrid,
  ClipboardList,
  Bell,
  ClipboardCheck,
  CalendarRange,
  CalendarClock,
  FileSignature,
  BarChart3,
  Users,
  MapPin,
  Tags,
  Wrench,
  LogOut,
} from 'lucide-react'
import { supabase } from '../lib/supabase'

const BUILT = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/', label: 'Assets', icon: LayoutGrid, end: true },
  { to: '/work-orders', label: 'Work Orders', icon: ClipboardList },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/inspections', label: 'Inspections', icon: ClipboardCheck },
  { to: '/maintenance-plans', label: 'Maintenance Plans', icon: Wrench },
  { to: '/reservations', label: 'Reservations', icon: CalendarRange },
  { to: '/rentals', label: 'Rentals', icon: CalendarClock },
  { to: '/leases', label: 'Leases', icon: FileSignature },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
]

const DIRECTORY = [{ to: '/contacts', label: 'Contacts', icon: Users }]

const SETUP = [
  { to: '/jobsites', label: 'Jobsites', icon: MapPin },
  { to: '/categories', label: 'Categories', icon: Tags },
]

function linkClasses({ isActive }) {
  return [
    'flex items-center gap-2.5 rounded px-3 py-2 text-sm transition-colors',
    isActive
      ? 'bg-amber-400/10 text-amber-400'
      : 'text-ink-300 hover:bg-graphite-700 hover:text-ink-100',
  ].join(' ')
}

function NavSection({ title, items }) {
  return (
    <div>
      {title && (
        <div className="px-3 pb-1.5 font-mono text-[11px] uppercase tracking-wide text-ink-500">
          {title}
        </div>
      )}
      <div className="space-y-1">
        {items.map((item) => (
          <NavLink key={item.label} to={item.to} end={item.end} className={linkClasses}>
            <item.icon size={17} strokeWidth={1.75} />
            {item.label}
          </NavLink>
        ))}
      </div>
    </div>
  )
}

export default function Sidebar() {
  const [email, setEmail] = useState('')
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email || ''))
  }, [])

  return (
    <aside className="flex h-full w-60 flex-col border-r border-graphite-700 bg-graphite-800">
      <div className="border-b border-graphite-700 px-4 py-5">
        <div className="font-mono text-xs uppercase tracking-wide text-ink-500">
          Sunbelt Utilities
        </div>
        <div className="text-lg font-semibold text-ink-100">Fleet</div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        <NavSection items={BUILT} />
        <NavSection title="Directory" items={DIRECTORY} />
        <NavSection title="Setup" items={SETUP} />
      </nav>

      <div className="border-t border-graphite-700 px-3 py-3">
        <div className="truncate px-3 pb-1.5 text-xs text-ink-500" title={email}>
          {email}
        </div>
        <button
          onClick={() => supabase.auth.signOut()}
          className="flex w-full items-center gap-2.5 rounded px-3 py-2 text-sm text-ink-300 transition-colors hover:bg-graphite-700 hover:text-ink-100"
        >
          <LogOut size={17} strokeWidth={1.75} />
          Sign out
        </button>
      </div>
    </aside>
  )
}
