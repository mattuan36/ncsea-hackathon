import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import {
  ArrowDownToLine,
  BarChart3,
  Database,
  FileText,
  FolderOpen,
  MoveHorizontal,
  Settings,
  Weight,
  type LucideIcon,
} from 'lucide-react';
import DocumentsPage from './pages/DocumentsPage';
import GravityPage from './pages/GravityPage';
import LateralPage from './pages/LateralPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import LoadsPage from './pages/LoadsPage';
import MaterialsPage from './pages/MaterialsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import { LtlProvider } from './ltl/store';
import AgentPanel from './agent/AgentPanel';

interface MenuItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

// Order as requested: Analytics, Documents, Settings, Loads, Materials DB, Lateral, Gravity, Reports.
const MENU: MenuItem[] = [
  { path: '/analytics', label: 'Analytics', icon: BarChart3 },
  { path: '/documents', label: 'Documents', icon: FolderOpen },
  { path: '/settings', label: 'Settings', icon: Settings },
  { path: '/loads', label: 'Loads', icon: Weight },
  { path: '/materials', label: 'Materials DB', icon: Database },
  { path: '/lateral', label: 'Lateral', icon: MoveHorizontal },
  { path: '/gravity', label: 'Gravity', icon: ArrowDownToLine },
  { path: '/reports', label: 'Reports', icon: FileText },
];

export default function App() {
  return (
    <LtlProvider>
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">L</span>
          <span className="brand-name">LightenTheLoad</span>
        </div>
        <nav className="nav">
          {MENU.map(({ path, label, icon: Icon }) => (
            <NavLink key={path} to={path} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <Icon size={18} strokeWidth={1.75} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/documents" replace />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/loads" element={<LoadsPage />} />
          <Route path="/materials" element={<MaterialsPage />} />
          <Route path="/gravity" element={<GravityPage />} />
          <Route path="/lateral" element={<LateralPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="*" element={<Navigate to="/documents" replace />} />
        </Routes>
      </main>
      <AgentPanel />
    </div>
    </LtlProvider>
  );
}
