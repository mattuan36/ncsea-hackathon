import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import {
  ArrowDownToLine,
  BarChart3,
  FileText,
  FolderOpen,
  MoveHorizontal,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import DocumentsPage from './pages/DocumentsPage';
import PlaceholderPage from './pages/PlaceholderPage';

interface MenuItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

// Order as requested: Analytics, Documents, Settings, Lateral, Gravity, Reports.
const MENU: MenuItem[] = [
  { path: '/analytics', label: 'Analytics', icon: BarChart3 },
  { path: '/documents', label: 'Documents', icon: FolderOpen },
  { path: '/settings', label: 'Settings', icon: Settings },
  { path: '/lateral', label: 'Lateral', icon: MoveHorizontal },
  { path: '/gravity', label: 'Gravity', icon: ArrowDownToLine },
  { path: '/reports', label: 'Reports', icon: FileText },
];

export default function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">S</span>
          <span className="brand-name">Structural</span>
        </div>
        <nav className="nav">
          {MENU.map(({ path, label, icon: Icon }) => (
            <NavLink key={path} to={path} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <Icon size={18} strokeWidth={1.75} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/documents" replace />} />
          <Route path="/documents" element={<DocumentsPage />} />
          {MENU.filter((m) => m.path !== '/documents').map(({ path, label, icon }) => (
            <Route key={path} path={path} element={<PlaceholderPage title={label} icon={icon} />} />
          ))}
          <Route path="*" element={<Navigate to="/documents" replace />} />
        </Routes>
      </main>
    </div>
  );
}
