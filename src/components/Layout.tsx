import { NavLink } from 'react-router-dom';
import { useState } from 'react';
import type { ReactNode } from 'react';
import GlobalSearch from './GlobalSearch';

const NAV = [
  { to: '/dashboard', label: 'Tableau de bord', icon: '📊', shortcut: 'D' },
  { to: '/imports', label: 'Importer des données', icon: '📥', shortcut: 'I' },
  { to: '/review', label: 'Centre de révision', icon: '🧭', shortcut: 'M' },
  { to: '/sales', label: 'Ventes', icon: '🛍️', shortcut: 'V' },
  { to: '/justificatifs-ventes', label: 'Justificatifs de ventes', icon: '🧾', shortcut: 'J' },
  { to: '/documents', label: 'Documents', icon: '🗂️', shortcut: 'O' },
  { to: '/purchases', label: 'Justificatifs d\'achats', icon: '📄', shortcut: 'A' },
  { to: '/stock', label: 'Stock', icon: '📦', shortcut: 'S' },
  { to: '/expenses', label: 'Dépenses', icon: '💸', shortcut: 'E' },
  { to: '/declarations', label: 'Déclaration URSSAF', icon: '🇫🇷', shortcut: 'U' },
  { to: '/rentabilite', label: 'Rentabilité', icon: '📈', shortcut: 'R' },
  { to: '/agenda', label: 'Agenda', icon: '📅', shortcut: 'G' },
  { to: '/settings', label: 'Réglages', icon: '⚙️', shortcut: ',' }
];

export default function Layout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('revendo.sidebarCollapsed') === 'true');

  const toggleSidebar = () => {
    setCollapsed((value) => {
      const next = !value;
      localStorage.setItem('revendo.sidebarCollapsed', String(next));
      return next;
    });
  };

  return (
    <div className={`app-shell flex h-full ${collapsed ? 'sidebar-is-collapsed' : ''}`}>
      <aside className={`sidebar-shell ${collapsed ? 'is-collapsed' : ''}`}>
        <div className="sidebar-brand">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Déplier le menu' : 'Replier le menu'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Déplier le menu' : 'Replier le menu'}
          >
            ☰
          </button>
          <div>
            <div className="brand-kicker">Centre de contrôle</div>
            <div className="brand-title">Revendo</div>
            <div className="brand-subtitle">Micro-entreprise · local-first</div>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label="Navigation principale">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              title={n.label}
              className={({ isActive }) =>
                `nav-item ${isActive ? 'nav-item-active' : ''}`
              }
            >
              <span className="nav-icon" aria-hidden="true">{n.icon}</span>
              <span className="nav-label">{n.label}</span>
              <span className="nav-shortcut">Ctrl+{n.shortcut}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span>v0.1</span>
          <span className="sidebar-status">Local-first</span>
        </div>
      </aside>
      <main className="app-main flex-1 overflow-y-auto p-7">
        <div className="app-topbar">
          <GlobalSearch />
        </div>
        {children}
      </main>
    </div>
  );
}
