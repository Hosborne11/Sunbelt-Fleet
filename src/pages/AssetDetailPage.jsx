import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Plus,
  ClipboardList,
  Bell,
  ClipboardCheck,
  CalendarClock,
  FileSignature,
  Wrench,
  AlertOctagon,
  TrendingUp,
  ShieldCheck,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { iconFor } from '../lib/categoryIcons'
import { bookValue, formatCurrency } from '../lib/depreciation'
import { computeDue } from '../lib/maintenanceDue'
import StatusBadge from '../components/StatusBadge'
import AssetDrawer from '../components/AssetDrawer'
import WorkOrderDrawer from '../components/WorkOrderDrawer'
import AlertDrawer from '../components/AlertDrawer'
import InspectionDrawer from '../components/InspectionDrawer'
import RentalDrawer from '../components/RentalDrawer'
import LeaseDrawer from '../components/LeaseDrawer'
import MaintenancePlanDrawer from '../components/MaintenancePlanDrawer'

export default function AssetDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [asset, setAsset] = useState(null)
  const [categories, setCategories] = useState([])
  const [jobsites, setJobsites] = useState([])
  const [allAssets, setAllAssets] = useState([])
  const [workOrders, setWorkOrders] = useState([])
  const [alerts, setAlerts] = useState([])
  const [inspections, setInspections] = useState([])
  const [rentals, setRentals] = useState([])
  const [leases, setLeases] = useState([])
  const [plans, setPlans] = useState([])
  const [downtimeEvents, setDowntimeEvents] = useState([])
  const [hourReadings, setHourReadings] = useState([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [assetDrawerOpen, setAssetDrawerOpen] = useState(false)
  const [drawer, setDrawer] = useState(null) // { type: 'work_order'|'alert'|..., record: obj|null }

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [
      assetRes,
      catsRes,
      jobsitesRes,
      allAssetsRes,
      woRes,
      alertsRes,
      inspRes,
      rentalsRes,
      leasesRes,
      plansRes,
      downtimeRes,
      hourRes,
    ] = await Promise.all([
      supabase
        .from('assets')
        .select('*, category:equipment_categories(id,name,icon), jobsite:jobsites(id,name)')
        .eq('id', id)
        .maybeSingle(),
      supabase.from('equipment_categories').select('*').order('sort_order'),
      supabase.from('jobsites').select('*').order('name'),
      supabase.from('assets').select('id, asset_number').order('asset_number'),
      supabase
        .from('work_orders')
        .select('*')
        .eq('asset_id', id)
        .order('due_date', { ascending: true, nullsFirst: false }),
      supabase.from('alerts').select('*').eq('asset_id', id).order('created_at', { ascending: false }),
      supabase
        .from('inspections')
        .select('*')
        .eq('asset_id', id)
        .order('inspected_at', { ascending: false }),
      supabase.from('rentals').select('*').eq('asset_id', id).order('start_date', { ascending: false }),
      supabase.from('leases').select('*').eq('asset_id', id).order('start_date', { ascending: false }),
      supabase.from('maintenance_plans').select('*').eq('asset_id', id).order('name'),
      supabase
        .from('downtime_events')
        .select('*')
        .eq('asset_id', id)
        .order('started_at', { ascending: false }),
      supabase
        .from('hour_meter_readings')
        .select('*')
        .eq('asset_id', id)
        .order('reading_date', { ascending: false })
        .limit(20),
    ])

    if (!assetRes.data) {
      setNotFound(true)
      setLoading(false)
      return
    }

    setAsset(assetRes.data)
    setCategories(catsRes.data || [])
    setJobsites(jobsitesRes.data || [])
    setAllAssets(allAssetsRes.data || [])
    setWorkOrders(woRes.data || [])
    setAlerts(alertsRes.data || [])
    setInspections(inspRes.data || [])
    setRentals(rentalsRes.data || [])
    setLeases(leasesRes.data || [])
    setPlans(plansRes.data || [])
    setDowntimeEvents(downtimeRes.data || [])
    setHourReadings(hourRes.data || [])
    setLoading(false)
  }, [id])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  function closeAllDrawers() {
    setAssetDrawerOpen(false)
    setDrawer(null)
  }
  function onAssetSaved() {
    closeAllDrawers()
    loadAll()
  }
  function onAssetDeleted() {
    navigate('/')
  }
  function onChildSaved() {
    closeAllDrawers()
    loadAll()
  }

  const value = useMemo(() => (asset ? bookValue(asset) : null), [asset])

  const enrichedPlans = useMemo(
    () => plans.map((p) => ({ ...p, due: computeDue(p, asset?.hour_meter) })),
    [plans, asset]
  )

  const openDowntime = downtimeEvents.find((d) => !d.ended_at)
  const closedDowntimeEvents = downtimeEvents.filter((d) => d.ended_at)
  const avgMttrHours =
    closedDowntimeEvents.length > 0
      ? closedDowntimeEvents.reduce(
          (sum, d) => sum + (new Date(d.ended_at) - new Date(d.started_at)) / 3600000,
          0
        ) / closedDowntimeEvents.length
      : null

  const utilizationRows = useMemo(() => {
    const sorted = [...hourReadings].sort((a, b) => new Date(a.reading_date) - new Date(b.reading_date))
    return sorted
      .map((r, i) => ({
        ...r,
        delta: i > 0 ? r.hours - sorted[i - 1].hours : null,
      }))
      .reverse()
  }, [hourReadings])

  if (loading) {
    return <div className="p-6 text-sm text-ink-500">Loading…</div>
  }

  if (notFound) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-ink-300">Asset not found.</p>
        <Link to="/" className="text-amber-400 hover:underline">
          Back to the registry
        </Link>
      </div>
    )
  }

  const Icon = iconFor(asset.category?.icon)
  const warrantyActive = asset.warranty_expiration && asset.warranty_expiration >= new Date().toISOString().slice(0, 10)

  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b border-graphite-700 px-6 py-5">
        <Link to="/" className="mb-3 flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-100">
          <ArrowLeft size={15} /> All assets
        </Link>
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded bg-graphite-800 text-ink-500">
              <Icon size={20} strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="font-mono text-xl font-semibold text-ink-100">{asset.asset_number}</h1>
              <p className="mt-0.5 text-sm text-ink-500">
                {[asset.make, asset.model].filter(Boolean).join(' ') || 'No make/model on file'}
                {asset.serial_number && (
                  <span className="ml-2 font-mono text-ink-500">S/N {asset.serial_number}</span>
                )}
              </p>
              <div className="mt-2 flex items-center gap-3 text-sm text-ink-300">
                <StatusBadge status={asset.status} />
                <span>{asset.jobsite?.name || 'Unassigned / yard'}</span>
                {asset.hour_meter != null && (
                  <span className="font-mono text-ink-500">{asset.hour_meter.toLocaleString()} hrs</span>
                )}
                {asset.warranty_expiration && (
                  <span
                    className={`flex items-center gap-1 ${warrantyActive ? 'text-teal-400' : 'text-ink-500'}`}
                  >
                    <ShieldCheck size={13} />
                    {warrantyActive ? 'Under warranty' : 'Warranty expired'} ({asset.warranty_expiration})
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={() => setAssetDrawerOpen(true)}
            className="rounded border border-graphite-600 px-3.5 py-2 text-sm text-ink-300 hover:bg-graphite-700"
          >
            Edit asset
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat
            label="Current book value"
            value={value ? formatCurrency(value.currentValue) : '—'}
          />
          <MiniStat
            label="Purchase price"
            value={asset.purchase_price != null ? formatCurrency(asset.purchase_price) : '—'}
          />
          <MiniStat
            label="Currently down"
            value={openDowntime ? hoursSince(openDowntime.started_at) : 'No'}
            tone={openDowntime ? 'rust' : undefined}
          />
          <MiniStat
            label="Avg. repair time"
            value={avgMttrHours != null ? `${avgMttrHours.toFixed(1)} hrs` : '—'}
          />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-2">
        <Section
          icon={ClipboardList}
          title="Work Orders"
          count={workOrders.length}
          onAdd={() => setDrawer({ type: 'work_order', record: null })}
        >
          {workOrders.map((w) => (
            <Row
              key={w.id}
              onClick={() => setDrawer({ type: 'work_order', record: w })}
              primary={w.title}
              secondary={w.due_date || 'no due date'}
              status={w.status}
            />
          ))}
        </Section>

        <Section
          icon={Bell}
          title="Alerts"
          count={alerts.length}
          onAdd={() => setDrawer({ type: 'alert', record: null })}
        >
          {alerts.map((a) => (
            <Row
              key={a.id}
              onClick={() => setDrawer({ type: 'alert', record: a })}
              primary={a.message}
              secondary={new Date(a.created_at).toLocaleDateString()}
              status={a.status}
            />
          ))}
        </Section>

        <Section
          icon={ClipboardCheck}
          title="Inspections"
          count={inspections.length}
          onAdd={() => setDrawer({ type: 'inspection', record: null })}
        >
          {inspections.map((i) => (
            <Row
              key={i.id}
              onClick={() => setDrawer({ type: 'inspection', record: i })}
              primary={i.inspection_type.toUpperCase()}
              secondary={i.inspected_at}
              status={i.result}
            />
          ))}
        </Section>

        <Section
          icon={Wrench}
          title="Maintenance Plans"
          count={enrichedPlans.length}
          onAdd={() => setDrawer({ type: 'maintenance_plan', record: null })}
        >
          {enrichedPlans.map((p) => (
            <Row
              key={p.id}
              onClick={() => setDrawer({ type: 'maintenance_plan', record: p })}
              primary={p.name}
              secondary={
                p.due.hoursRemaining != null
                  ? `${Math.round(p.due.hoursRemaining)} hrs left`
                  : p.due.dueDate || 'no data'
              }
              status={p.due.status}
            />
          ))}
        </Section>

        <Section
          icon={CalendarClock}
          title="Rentals"
          count={rentals.length}
          onAdd={() => setDrawer({ type: 'rental', record: null })}
        >
          {rentals.map((r) => (
            <Row
              key={r.id}
              onClick={() => setDrawer({ type: 'rental', record: r })}
              primary={r.renter}
              secondary={r.start_date}
              status={r.status}
            />
          ))}
        </Section>

        <Section
          icon={FileSignature}
          title="Leases"
          count={leases.length}
          onAdd={() => setDrawer({ type: 'lease', record: null })}
        >
          {leases.map((l) => (
            <Row
              key={l.id}
              onClick={() => setDrawer({ type: 'lease', record: l })}
              primary={l.lessee}
              secondary={l.start_date}
              status={l.status}
            />
          ))}
        </Section>

        <div className="rounded border border-graphite-700 bg-graphite-800/40">
          <div className="flex items-center justify-between border-b border-graphite-700 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink-100">
              <AlertOctagon size={16} strokeWidth={1.75} className="text-ink-500" />
              Downtime history
              <span className="font-normal text-ink-500">({downtimeEvents.length})</span>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {downtimeEvents.length === 0 ? (
              <p className="px-4 py-4 text-sm text-ink-500">No downtime recorded.</p>
            ) : (
              downtimeEvents.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between border-b border-graphite-800 px-4 py-2.5 text-sm last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-ink-100">{new Date(d.started_at).toLocaleDateString()}</div>
                    <div className="truncate font-mono text-xs text-ink-500">
                      {d.ended_at
                        ? `${(
                            (new Date(d.ended_at) - new Date(d.started_at)) /
                            3600000
                          ).toFixed(1)} hrs down`
                        : 'Still down'}
                    </div>
                  </div>
                  {!d.ended_at && (
                    <span className="ml-3 shrink-0 rounded border border-rust-500/30 bg-rust-500/15 px-2 py-0.5 text-xs text-rust-400">
                      Ongoing
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded border border-graphite-700 bg-graphite-800/40">
          <div className="flex items-center justify-between border-b border-graphite-700 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink-100">
              <TrendingUp size={16} strokeWidth={1.75} className="text-ink-500" />
              Hour meter history
              <span className="font-normal text-ink-500">({utilizationRows.length})</span>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {utilizationRows.length === 0 ? (
              <p className="px-4 py-4 text-sm text-ink-500">
                No readings yet — logged automatically whenever the hour meter is updated.
              </p>
            ) : (
              utilizationRows.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between border-b border-graphite-800 px-4 py-2.5 text-sm last:border-b-0"
                >
                  <span className="text-ink-100">{r.reading_date}</span>
                  <span className="font-mono text-ink-300">{r.hours.toLocaleString()} hrs</span>
                  <span className="font-mono text-xs text-ink-500">
                    {r.delta != null ? `+${r.delta.toLocaleString()}` : '—'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {assetDrawerOpen && (
        <AssetDrawer
          asset={asset}
          categories={categories}
          jobsites={jobsites}
          onClose={closeAllDrawers}
          onSaved={onAssetSaved}
          onDeleted={onAssetDeleted}
        />
      )}

      {drawer?.type === 'work_order' && (
        <WorkOrderDrawer
          workOrder={drawer.record}
          assets={allAssets}
          defaultAssetId={id}
          onClose={closeAllDrawers}
          onSaved={onChildSaved}
          onDeleted={onChildSaved}
        />
      )}
      {drawer?.type === 'alert' && (
        <AlertDrawer
          alert={drawer.record}
          assets={allAssets}
          defaultAssetId={id}
          onClose={closeAllDrawers}
          onSaved={onChildSaved}
          onDeleted={onChildSaved}
        />
      )}
      {drawer?.type === 'inspection' && (
        <InspectionDrawer
          inspection={drawer.record}
          assets={allAssets}
          defaultAssetId={id}
          onClose={closeAllDrawers}
          onSaved={onChildSaved}
          onDeleted={onChildSaved}
        />
      )}
      {drawer?.type === 'rental' && (
        <RentalDrawer
          rental={drawer.record}
          assets={allAssets}
          defaultAssetId={id}
          onClose={closeAllDrawers}
          onSaved={onChildSaved}
          onDeleted={onChildSaved}
        />
      )}
      {drawer?.type === 'lease' && (
        <LeaseDrawer
          lease={drawer.record}
          assets={allAssets}
          defaultAssetId={id}
          onClose={closeAllDrawers}
          onSaved={onChildSaved}
          onDeleted={onChildSaved}
        />
      )}
      {drawer?.type === 'maintenance_plan' && (
        <MaintenancePlanDrawer
          plan={drawer.record}
          assets={allAssets}
          defaultAssetId={id}
          onClose={closeAllDrawers}
          onSaved={onChildSaved}
          onDeleted={onChildSaved}
        />
      )}
    </div>
  )
}

function hoursSince(dateStr) {
  const hrs = (Date.now() - new Date(dateStr).getTime()) / 3600000
  return `${hrs.toFixed(1)} hrs`
}

function MiniStat({ label, value, tone }) {
  const toneCls = tone === 'rust' ? 'text-rust-400' : 'text-ink-100'
  return (
    <div className="rounded border border-graphite-700 bg-graphite-800 px-3 py-2.5">
      <div className={`text-base font-semibold ${toneCls}`}>{value}</div>
      <div className="text-xs text-ink-500">{label}</div>
    </div>
  )
}

function Section({ icon: Icon, title, count, onAdd, children }) {
  return (
    <div className="rounded border border-graphite-700 bg-graphite-800/40">
      <div className="flex items-center justify-between border-b border-graphite-700 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink-100">
          <Icon size={16} strokeWidth={1.75} className="text-ink-500" />
          {title}
          <span className="font-normal text-ink-500">({count})</span>
        </div>
        <button
          onClick={onAdd}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-ink-500 hover:bg-graphite-700 hover:text-ink-100"
        >
          <Plus size={13} /> New
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {count === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-500">Nothing here yet.</p>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

function Row({ onClick, primary, secondary, status }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between border-b border-graphite-800 px-4 py-2.5 text-left text-sm last:border-b-0 hover:bg-graphite-800/60"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-ink-100">{primary}</div>
        <div className="truncate font-mono text-xs text-ink-500">{secondary}</div>
      </div>
      <span className="ml-3 shrink-0 rounded border border-graphite-600 px-2 py-0.5 text-xs capitalize text-ink-300">
        {status?.replace('_', ' ')}
      </span>
    </button>
  )
}
