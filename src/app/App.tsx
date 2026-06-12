import { createBrowserRouter, RouterProvider, Outlet, NavLink } from 'react-router-dom';
import { Coffee, Home, Plus, BarChart3, Calendar, Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { HomePage } from '@/features/home/HomePage';
import { AddCoffeePage } from '@/features/capture/AddCoffeePage';
import { CaptureDemo } from '@/features/capture/CaptureDemo';
import { BeanDetailPage } from '@/features/beans/BeanDetailPage';
import { AnalyticsPage } from '@/features/analytics/AnalyticsPage';
import { SummaryPage } from '@/features/summary/SummaryPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { cn } from '@/lib/utils';

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function Shell() {
  const online = useOnlineStatus();
  // Start the background queue runner for pending AI tasks
  useEffect(() => {
    // Start the runner lazily on mount
    void import('@/services/queue/queueRunner').then((m) => m.startQueueRunner());
  }, []);

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="container flex h-14 items-center gap-3">
          <Coffee className="text-primary" aria-hidden="true" />
          <h1 className="text-base font-semibold">Agentic Coffee Tracker</h1>
        </div>
        {!online && (
          <div
            role="status"
            className="bg-accent px-4 py-1 text-center text-xs text-accent-foreground"
          >
            Offline. New entries will sync details when you reconnect.
          </div>
        )}
      </header>

      <main className="container flex-1 py-6">
        <Outlet />
      </main>

      <nav
        aria-label="Primary"
        className="sticky bottom-0 z-30 border-t bg-background/95 backdrop-blur"
      >
        <ul className="container grid grid-cols-5">
          <NavItem to="/" icon={<Home />} label="Home" />
          <NavItem to="/add" icon={<Plus />} label="Add" />
          <NavItem to="/analytics" icon={<BarChart3 />} label="Analytics" />
          <NavItem to="/summary" icon={<Calendar />} label="Summary" />
          <NavItem to="/settings" icon={<SettingsIcon />} label="Settings" />
        </ul>
      </nav>
    </div>
  );
}

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <li>
      <NavLink
        to={to}
        end={to === '/'}
        className={({ isActive }) =>
          cn(
            'flex flex-col items-center gap-1 py-3 text-xs font-medium',
            isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )
        }
      >
        <span aria-hidden="true">{icon}</span>
        {label}
      </NavLink>
    </li>
  );
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'add', element: <AddCoffeePage /> },
      { path: 'capture-demo', element: <CaptureDemo /> },
      { path: 'beans/:beanId', element: <BeanDetailPage /> },
      { path: 'analytics', element: <AnalyticsPage /> },
      { path: 'summary', element: <SummaryPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
