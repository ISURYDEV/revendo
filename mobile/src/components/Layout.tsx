import { NavLink, Outlet } from 'react-router-dom';
import type { ReactNode } from 'react';

const TABS = [
  { to: '/', label: 'Accueil', icon: '🏠' },
  { to: '/urssaf', label: 'URSSAF', icon: '📊' },
  { to: '/stock', label: 'Stock', icon: '📦' },
  { to: '/search', label: 'Recherche', icon: '🔎' },
  { to: '/settings', label: 'Réglages', icon: '⚙️' }
];

export function Layout({ children }: { children?: ReactNode }) {
  return (
    <div className="min-h-screen">
      <main className="app-main">
        {children ?? <Outlet />}
      </main>
      <nav className="tab-bar">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={({ isActive }) => `tab-btn ${isActive ? 'active' : ''}`}
          >
            <span className="text-lg leading-none">{t.icon}</span>
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
