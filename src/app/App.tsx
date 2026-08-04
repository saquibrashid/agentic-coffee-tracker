import { createBrowserRouter, RouterProvider, Outlet, NavLink } from 'react-router-dom';
import {
  Coffee,
  Home,
  Plus,
  BarChart3,
  Calendar,
  Sparkles,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { HomePage } from '@/features/home/HomePage';
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
        <ul className="container grid grid-cols-6">
          <NavItem to="/" icon={<Home />} label="Home" />
          <NavItem to="/add" icon={<Plus />} label="Add" />
          <NavItem to="/for-you" icon={<Sparkles />} label="For you" />
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

// Home is eagerly bundled because it is the landing route; every other route is
// code-split so the initial payload stays inside the performance budget. The
// heavy dependencies (chart library, capture/image pipeline) ride along with the
// route that actually needs them.
const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <HomePage /> },
      {
        path: 'add',
        lazy: async () => ({ Component: (await import('@/features/capture/AddCoffeePage')).AddCoffeePage }),
      },
      {
        path: 'beans/:beanId',
        lazy: async () => ({ Component: (await import('@/features/beans/BeanDetailPage')).BeanDetailPage }),
      },
      {
        path: 'analytics',
        lazy: async () => ({ Component: (await import('@/features/analytics/AnalyticsPage')).AnalyticsPage }),
      },
      {
        path: 'for-you',
        lazy: async () => ({
          Component: (await import('@/features/recommendations/RecommendationsPage')).RecommendationsPage,
        }),
      },
      {
        path: 'summary',
        lazy: async () => ({ Component: (await import('@/features/summary/SummaryPage')).SummaryPage }),
      },
      {
        path: 'settings',
        lazy: async () => ({ Component: (await import('@/features/settings/SettingsPage')).SettingsPage }),
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
