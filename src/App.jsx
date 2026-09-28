import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import DashboardPage from './pages/DashboardPage'
import AssetsPage from './pages/AssetsPage'
import AssetDetailPage from './pages/AssetDetailPage'
import WorkOrdersPage from './pages/WorkOrdersPage'
import AlertsPage from './pages/AlertsPage'
import InspectionsPage from './pages/InspectionsPage'
import MaintenancePlansPage from './pages/MaintenancePlansPage'
import ReservationsPage from './pages/ReservationsPage'
import RentalsPage from './pages/RentalsPage'
import LeasesPage from './pages/LeasesPage'
import ReportsPage from './pages/ReportsPage'
import ContactsPage from './pages/ContactsPage'
import JobsitesPage from './pages/JobsitesPage'
import CategoriesPage from './pages/CategoriesPage'
import AuthGate from './components/AuthGate'

export default function App() {
  return (
    <AuthGate>
    <BrowserRouter>
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/" element={<AssetsPage />} />
            <Route path="/assets/:id" element={<AssetDetailPage />} />
            <Route path="/work-orders" element={<WorkOrdersPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/inspections" element={<InspectionsPage />} />
            <Route path="/maintenance-plans" element={<MaintenancePlansPage />} />
            <Route path="/reservations" element={<ReservationsPage />} />
            <Route path="/rentals" element={<RentalsPage />} />
            <Route path="/leases" element={<LeasesPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/jobsites" element={<JobsitesPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
    </AuthGate>
  )
}
