import { NavLink, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import type { Role } from '../lib/types';

interface NavItem {
  to: string;
  label: string;
  roles: Role[];
}

const NAV: NavItem[] = [
  { to: '/search', label: 'Find medicine', roles: ['PATIENT'] },
  { to: '/reservations', label: 'My reservations', roles: ['PATIENT'] },
  { to: '/claim', label: 'Claim', roles: ['PHARMACIST', 'ADMIN'] },
  { to: '/inventory', label: 'Inventory', roles: ['PHARMACIST', 'ADMIN'] },
  { to: '/inventory/sync', label: 'Batch sync', roles: ['PHARMACIST', 'ADMIN'] },
  { to: '/admin/pharmacies', label: 'Pharmacies', roles: ['ADMIN'] },
  { to: '/admin/medicines', label: 'Medicines', roles: ['ADMIN'] },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const items = NAV.filter((item) => (user ? item.roles.includes(user.role) : false));

  return (
    <div className="min-h-full">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="text-lg font-black tracking-tight text-brand-700">MediStock</span>

          <nav className="flex flex-1 flex-wrap items-center gap-1">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {user && (
            <div className="flex items-center gap-3 text-sm">
              <span className="hidden text-slate-500 sm:inline">
                {user.email} · <span className="font-semibold text-slate-700">{user.role}</span>
              </span>
              <button
                onClick={() => {
                  logout();
                  navigate('/login', { replace: true });
                }}
                className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
