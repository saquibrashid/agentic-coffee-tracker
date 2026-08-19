import { createBrowserRouter, RouterProvider, Outlet, NavLink } from 'react-router-dom';
import {
  Bean,
  Coffee,
  Home,
  Plus,
  BarChart3,
  Calendar,
  Sparkles,
  ScanSearch,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { HomePage } from '@/features/home/HomePage';
import { useSyncStatus } from '@/services/sync/useSyncStatus';
import { cn } from '@/lib/utils';
import { HeaderAccountControl, ReauthenticateButton } from './AccountControl';
import { syncMessage } from './syncNotice';

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
  const sync = useSyncStatus();
  const syncNotice = syncMessage(sync);

  // Start the background queue runner for pending AI tasks
  useEffect(() => {
    // Start the runner lazily on mount
    void import('@/services/queue/queueRunner').then((m) => m.startQueueRunner());
  }, []);

  // Backfill roast levels that are inferable from text we already hold. Offline
  // and cheap, so it runs ahead of (and independently of) the network-bound
  // enrichment queue rather than making the user wait on a lookup per bean.
  useEffect(() => {
    void import('@/services/enrich/backfillRoast').then((m) => m.backfillRoastLevels());
  }, []);

  // Sync starts on app open, per specs/sync.md -> Triggers. Lazy for the same
  // reason as the queue runner: neither is needed for first paint, and the
  // Cosmos-facing engine pulls in code a signed-out user never runs.
  useEffect(() => {
    void import('@/services/sync').then((m) => m.startSyncEngine());
  }, []);

  return (
    // min-h-dvh, not min-h-full. `min-h-full` is `min-height: 100%`, which needs
    // a parent with a definite height to resolve against -- html and body are
    // `h-full`, but #root is not, so the percentage was silently ignored and the
    // shell was only ever as tall as its content. That left `flex-1` on <main>
    // with nothing to stretch into and the sticky nav sitting wherever the
    // content happened to stop: at the bottom on a long page like Home, halfway
    // up the screen on a short one like Summary. Sticky alone cannot fix that --
    // it pins an element only while its container outruns the viewport.
    // The dynamic viewport unit is what mobile browsers want here: it tracks the
    // address bar collapsing, where `100vh` would sit permanently underneath it.
    <div className="flex min-h-dvh flex-col">
      <header className="bg-background/95 sticky top-0 z-30 border-b backdrop-blur-sm">
        <div className="relative container flex h-16 items-center gap-2 overflow-visible sm:gap-3">
          <div className="bg-primary/10 text-primary relative flex size-10 shrink-0 items-center justify-center rounded-xl border">
            <Coffee className="size-6" aria-hidden="true" />
            <Bean
              className="bg-background absolute -right-1 -bottom-1 size-4 rounded-full"
              aria-hidden="true"
            />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display truncate text-lg leading-tight font-semibold">
              Coffee Bean Tracker
            </h1>
            <p className="text-muted-foreground hidden text-[11px] sm:block">
              Your taste, remembered.
            </p>
          </div>
          <div
            className="pointer-events-none absolute top-0 right-14 hidden h-full w-24 opacity-30 min-[390px]:block sm:right-16 sm:w-32 sm:opacity-40"
            aria-hidden="true"
          >
            <Bean className="text-primary/20 absolute top-1 right-10 size-10 rotate-12" />
            <Bean className="text-primary/15 absolute right-0 bottom-0 size-7 -rotate-12" />
            <div className="bg-primary/10 absolute top-3 right-3 size-16 rounded-full blur-xl" />
          </div>
          <HeaderAccountControl />
        </div>
        {!online && (
          <div
            role="status"
            className="bg-accent text-accent-foreground px-4 py-1 text-center text-xs"
          >
            Offline. New entries will sync details when you reconnect.
          </div>
        )}
        {syncNotice && (
          <div
            role="alert"
            className={cn(
              'px-4 py-1 text-center text-xs',
              sync.state === 'session-expired'
                ? 'bg-accent text-accent-foreground'
                : 'bg-destructive text-white',
            )}
          >
            {syncNotice}
            {sync.state === 'session-expired' && <ReauthenticateButton />}
          </div>
        )}
      </header>

      <main className="container flex-1 py-6">
        <Outlet />
      </main>

      <nav
        aria-label="Primary"
        // The safe-area padding is dead weight in a browser tab (the inset is
        // 0) and load-bearing once the app is installed to the home screen:
        // with `viewport-fit=cover` and no browser chrome, the bottom of the
        // screen is the home indicator, and the nav labels would sit under it.
        className="bg-background/95 sticky bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-sm"
      >
        <ul className="container grid grid-cols-7">
          <NavItem to="/" icon={<Home />} label="Home" />
          <NavItem to="/add" icon={<Plus />} label="Add" />
          <NavItem to="/predict" icon={<ScanSearch />} label="Check" />
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
    <li className="min-w-0">
      <NavLink
        to={to}
        end={to === '/'}
        className={({ isActive }) =>
          cn(
            'flex flex-col items-center gap-1 py-3 text-[10px] leading-tight font-medium tracking-tight sm:text-xs sm:tracking-normal',
            isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )
        }
      >
        <span aria-hidden="true">{icon}</span>
        <span className="block w-full truncate text-center">{label}</span>
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
        lazy: async () => ({
          Component: (await import('@/features/capture/AddCoffeePage')).AddCoffeePage,
        }),
      },
      {
        path: 'beans',
        lazy: async () => ({
          Component: (await import('@/features/beans/BeansLibraryPage')).BeansLibraryPage,
        }),
      },
      {
        path: 'beans/:beanId',
        lazy: async () => ({
          Component: (await import('@/features/beans/BeanDetailPage')).BeanDetailPage,
        }),
      },
      {
        path: 'analytics',
        lazy: async () => ({
          Component: (await import('@/features/analytics/AnalyticsPage')).AnalyticsPage,
        }),
      },
      {
        path: 'for-you',
        lazy: async () => ({
          Component: (await import('@/features/recommendations/RecommendationsPage'))
            .RecommendationsPage,
        }),
      },
      {
        path: 'predict',
        lazy: async () => ({
          Component: (await import('@/features/predict/PredictPage')).PredictPage,
        }),
      },
      {
        path: 'summary',
        lazy: async () => ({
          Component: (await import('@/features/summary/SummaryPage')).SummaryPage,
        }),
      },
      {
        path: 'settings',
        lazy: async () => ({
          Component: (await import('@/features/settings/SettingsPage')).SettingsPage,
        }),
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
