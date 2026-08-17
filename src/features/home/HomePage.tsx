import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowRight,
  BarChart3,
  Bean,
  Coffee,
  FileUp,
  Plus,
  ScanSearch,
  Sparkles,
  Star,
} from 'lucide-react';

import { db } from '@/services/db';
import type { CoffeeBean, Rating } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { RoastScale } from '@/components/ui/roast-scale';
import { Skeleton } from '@/components/ui/skeleton';
import { BeanThumbnail } from '@/features/beans/BeanThumbnail';
import { usePhotoObjectUrl } from '@/features/beans/usePhotoObjectUrl';

interface BeanHighlight {
  bean: CoffeeBean;
  count: number;
  average: number;
}

interface HomeDashboard {
  recentBeans: CoffeeBean[];
  totalBeans: number;
  ratings: Rating[];
  featuredBean: CoffeeBean;
  featuredRating: Rating | undefined;
  favorite: BeanHighlight | undefined;
  averageScore: number | undefined;
  latestActivityAt: string;
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function welcomeCopy(dashboard: HomeDashboard): { eyebrow: string; title: string; body: string } {
  if (dashboard.ratings.length === 0) {
    return {
      eyebrow: 'Your shelf is taking shape',
      title: 'Ready for the next great cup?',
      body: 'Add a rating to start turning your coffee collection into a taste profile.',
    };
  }

  const inactiveForDays =
    (Date.now() - new Date(dashboard.latestActivityAt).getTime()) / (24 * 60 * 60 * 1000);
  if (inactiveForDays > 45) {
    return {
      eyebrow: 'Welcome back',
      title: 'Your coffee shelf has been waiting.',
      body: 'Pick up with a recent coffee, or check something new before you taste it.',
    };
  }

  if (dashboard.ratings.length < 5) {
    return {
      eyebrow: 'Every cup adds detail',
      title: 'Your taste profile is brewing.',
      body: 'Rate another coffee and the patterns behind your favorites will get clearer.',
    };
  }

  return {
    eyebrow: 'Good to see you',
    title: 'What are you tasting next?',
    body: 'Continue with a recent favorite or explore what your coffee history is revealing.',
  };
}

async function loadDashboard(): Promise<HomeDashboard | null> {
  const [allBeans, allRatings] = await Promise.all([db.beans.toArray(), db.ratings.toArray()]);
  const beans = allBeans.filter((bean) => !bean.isArchived);
  if (beans.length === 0) return null;

  const recentBeans = [...beans].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  const beanById = new Map(beans.map((bean) => [bean.id, bean]));
  const ratings = allRatings
    .filter((rating) => beanById.has(rating.beanId))
    .sort((a, b) => b.ratedAt.localeCompare(a.ratedAt));
  const featuredRating = ratings[0];
  const featuredBean = (featuredRating && beanById.get(featuredRating.beanId)) ?? recentBeans[0]!;

  const scoresByBean = new Map<string, number[]>();
  for (const rating of ratings) {
    const scores = scoresByBean.get(rating.beanId) ?? [];
    scores.push(rating.score);
    scoresByBean.set(rating.beanId, scores);
  }

  const favorite = [...scoresByBean.entries()]
    .map(([beanId, scores]) => ({
      bean: beanById.get(beanId)!,
      count: scores.length,
      average: average(scores)!,
    }))
    .sort((a, b) => b.average - a.average || b.count - a.count)[0];

  return {
    recentBeans,
    totalBeans: beans.length,
    ratings,
    featuredBean,
    featuredRating: ratings.find((rating) => rating.beanId === featuredBean.id),
    favorite,
    averageScore: average(ratings.map((rating) => rating.score)),
    latestActivityAt: ratings[0]?.ratedAt ?? featuredBean.updatedAt,
  };
}

export function HomePage() {
  const dashboard = useLiveQuery(loadDashboard, []);
  const featuredPhotoUrl = usePhotoObjectUrl(
    dashboard?.featuredBean.photoId
      ? { kind: 'stored', photoId: dashboard.featuredBean.photoId }
      : undefined,
  );

  if (dashboard === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (dashboard === null) {
    return (
      <EmptyState
        icon={<Coffee />}
        title="Welcome to Coffee Bean Tracker"
        description="Snap a photo of a bag and we'll read the roaster, origin and tasting notes off the label for you."
        action={
          <Button asChild size="lg">
            <Link to="/add">
              <Plus aria-hidden="true" /> Add your first coffee
            </Link>
          </Button>
        }
      />
    );
  }

  const welcome = welcomeCopy(dashboard);
  const { featuredBean, featuredRating } = dashboard;

  return (
    <div className="space-y-8">
      <section
        aria-labelledby="home-welcome"
        className="from-primary/15 via-card to-accent/70 relative overflow-hidden rounded-2xl border bg-linear-to-br p-6 shadow-sm sm:p-8"
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <Bean className="text-primary/10 absolute -top-7 right-12 size-28 rotate-12" />
          <Bean className="text-primary/10 absolute -right-5 bottom-0 size-20 -rotate-12" />
          <div className="bg-primary/8 absolute top-6 right-28 size-28 rounded-full blur-2xl" />
        </div>
        <div className="relative max-w-2xl">
          <p className="text-meta text-primary flex items-center gap-2">
            <Sparkles className="size-4" aria-hidden="true" />
            {welcome.eyebrow}
          </p>
          <h2 id="home-welcome" className="font-display mt-2 text-3xl leading-tight font-semibold">
            {welcome.title}
          </h2>
          <p className="text-muted-foreground mt-3 max-w-xl text-sm leading-relaxed sm:text-base">
            {welcome.body}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild>
              <Link to={`/beans/${featuredBean.id}`}>
                <Star aria-hidden="true" /> Rate a recent coffee
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/predict">
                <ScanSearch aria-hidden="true" /> Check before tasting
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="quick-actions">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-meta text-muted-foreground">Keep your log moving</p>
            <h2 id="quick-actions" className="text-lg font-semibold">
              Quick actions
            </h2>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <QuickAction
            to="/add"
            icon={<Plus />}
            title="Add a coffee"
            detail="Photo, link, or manual"
          />
          <QuickAction
            to="/predict"
            icon={<ScanSearch />}
            title="Check a coffee"
            detail="See if it fits your taste"
          />
          <QuickAction
            to={`/beans/${featuredBean.id}`}
            icon={<Star />}
            title="Rate a cup"
            detail={featuredBean.name}
          />
          <QuickAction
            to="/settings"
            icon={<FileUp />}
            title="Import history"
            detail="Bring older ratings in"
          />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]" aria-label="Your coffee right now">
        <Card className="overflow-hidden">
          <div className="grid h-full sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            {featuredBean.thumbnailDataUrl ? (
              <img
                src={featuredPhotoUrl ?? featuredBean.thumbnailDataUrl}
                alt=""
                className="h-48 w-full object-cover sm:h-full sm:min-h-64"
              />
            ) : (
              <div
                className="from-primary/20 via-accent to-muted flex min-h-44 items-center justify-center bg-linear-to-br sm:min-h-64"
                aria-hidden="true"
              >
                <Coffee className="text-primary/70 size-16" />
              </div>
            )}
            <CardContent className="flex flex-col justify-center p-6">
              <p className="text-meta text-primary">Continue with this coffee</p>
              <h2 className="font-display mt-1 text-2xl font-semibold">{featuredBean.name}</h2>
              <p className="text-muted-foreground text-sm">{featuredBean.roaster}</p>
              <RoastScale level={featuredBean.roastLevel} compact className="mt-3" />
              {featuredRating && (
                <p className="mt-4 text-sm">
                  Your latest rating: <strong>{featuredRating.score}/10</strong>
                </p>
              )}
              <Button asChild variant="outline" className="mt-5 self-start">
                <Link to={`/beans/${featuredBean.id}`}>
                  Open coffee <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </CardContent>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <InsightCard
            icon={<Star />}
            label="Ratings logged"
            value={String(dashboard.ratings.length)}
            detail={
              dashboard.ratings.length === 1
                ? 'One rating remembered'
                : 'Ratings shaping your profile'
            }
            to="/analytics"
          />
          <InsightCard
            icon={<BarChart3 />}
            label="Average score"
            value={dashboard.averageScore?.toFixed(1) ?? '—'}
            detail="Across your ratings"
            to="/analytics"
          />
          <InsightCard
            icon={<Bean />}
            label="Coffees saved"
            value={String(dashboard.totalBeans)}
            detail="In your coffee library"
            to="/beans"
          />
          <InsightCard
            icon={<Sparkles />}
            label="Current favorite"
            value={dashboard.favorite?.bean.name ?? 'Rate a cup'}
            detail={
              dashboard.favorite
                ? `${dashboard.favorite.average.toFixed(1)} average`
                : 'Unlock a recommendation'
            }
            to="/for-you"
            compactValue
          />
        </div>
      </section>

      <section aria-labelledby="recent-beans">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-meta text-muted-foreground">Back on your shelf</p>
            <h2 id="recent-beans" className="text-lg font-semibold">
              Recent coffees
            </h2>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/beans">
              View all {dashboard.totalBeans} <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {dashboard.recentBeans.map((bean) => (
            <li key={bean.id}>
              <Link to={`/beans/${bean.id}`} className="block h-full">
                <Card className="h-full transition hover:-translate-y-0.5 hover:shadow-md">
                  <CardHeader className="flex-row items-start gap-3 space-y-0">
                    <BeanThumbnail dataUrl={bean.thumbnailDataUrl} />
                    <div className="min-w-0 flex-1">
                      <CardTitle className="line-clamp-2 text-base">{bean.name}</CardTitle>
                      <CardDescription className="truncate">{bean.roaster}</CardDescription>
                      <RoastScale level={bean.roastLevel} compact className="pt-1" />
                    </div>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function QuickAction({
  to,
  icon,
  title,
  detail,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <Link
      to={to}
      className="bg-card hover:bg-accent/45 group rounded-xl border p-4 transition hover:-translate-y-0.5 hover:shadow-sm"
    >
      <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg">
        <span aria-hidden="true">{icon}</span>
      </span>
      <span className="mt-3 block text-sm font-semibold">{title}</span>
      <span className="text-muted-foreground mt-0.5 block truncate text-xs">{detail}</span>
    </Link>
  );
}

function InsightCard({
  icon,
  label,
  value,
  detail,
  to,
  compactValue = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  to: string;
  compactValue?: boolean;
}) {
  return (
    <Link to={to} className="group">
      <Card className="h-full transition group-hover:-translate-y-0.5 group-hover:shadow-md">
        <CardContent className="p-4">
          <div className="text-primary flex items-center gap-2">
            <span aria-hidden="true">{icon}</span>
            <span className="text-meta text-muted-foreground">{label}</span>
          </div>
          <p
            className={`mt-3 font-semibold ${compactValue ? 'line-clamp-2 text-base' : 'text-2xl'}`}
          >
            {value}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">{detail}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
