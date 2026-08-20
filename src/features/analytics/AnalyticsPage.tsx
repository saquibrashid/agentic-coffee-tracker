import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BarChart3,
  Bean,
  CalendarDays,
  Compass,
  Lightbulb,
  Plus,
  Star,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SampleDataNotice } from '@/features/sample/SampleDataNotice';
import {
  computeAnalytics,
  type AnalyticsRange,
  type CategoryMetric,
} from '@/services/analytics/compute';
import { MAX_SCORE } from '@/services/ratings/scale';

const RANGE_OPTIONS: { value: AnalyticsRange; label: string }[] = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '1y', label: 'Last year' },
  { value: 'all', label: 'All time' },
];

const TOOLTIP_STYLE = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '0.75rem',
  color: 'hsl(var(--card-foreground))',
};

function label(value: string): string {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function MetricCard({
  icon,
  label: metricLabel,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="relative pt-4 sm:pt-5">
        <div
          className="bg-accent text-accent-foreground absolute -top-5 -right-5 flex size-20 items-end justify-start rounded-full p-4 opacity-70 [&_svg]:size-5"
          aria-hidden="true"
        >
          {icon}
        </div>
        <p className="text-meta text-muted-foreground">{metricLabel}</p>
        <p className="font-display mt-1 text-3xl font-semibold">{value}</p>
        <div className="text-muted-foreground mt-1 text-xs">{detail}</div>
      </CardContent>
    </Card>
  );
}

/** How many rows a breakdown shows before the user asks for the rest. */
const BREAKDOWN_PREVIEW = 8;

function RankedBreakdown({
  title,
  description,
  items,
  baseline,
}: {
  title: string;
  description: string;
  items: CategoryMetric[];
  /** The user's overall average in this range. Divides praise from complaint. */
  baseline: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, BREAKDOWN_PREVIEW);
  const hidden = items.length - visible.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">Not enough tagged ratings in this view.</p>
        ) : (
          <>
            <ol className="space-y-3">
              {visible.map((item) => {
                const liked = item.weightedScore > baseline;
                return (
                  <li key={item.value}>
                    <div className="mb-1 flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-medium">{label(item.value)}</span>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {item.averageScore.toFixed(1)} avg · {item.count}{' '}
                        {item.count === 1 ? 'rating' : 'ratings'}
                        {item.beanCount < item.count
                          ? ` from ${item.beanCount} ${item.beanCount === 1 ? 'coffee' : 'coffees'}`
                          : ''}
                      </span>
                    </div>
                    <div className="bg-muted h-2 overflow-hidden rounded-full">
                      <div
                        className={`h-full rounded-full ${liked ? 'bg-primary' : 'bg-muted-foreground/50'}`}
                        style={{ width: `${Math.max(4, (item.weightedScore / MAX_SCORE) * 100)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="text-muted-foreground mt-4 text-xs">
              Ordered by score, held back where there are few ratings, so one great cup cannot top
              the list on its own. A grey bar is below your {baseline.toFixed(1)} average.
            </p>
            {hidden > 0 || expanded ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 h-auto px-0 text-xs"
                onClick={() => setExpanded((open) => !open)}
              >
                {expanded ? 'Show fewer' : `Show all ${items.length}`}
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function AnalyticsPage() {
  const [range, setRange] = useState<AnalyticsRange>('all');
  const data = useLiveQuery(() => computeAnalytics(range), [range]);

  if (data === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  if (data.totalBeans === 0) {
    return (
      <EmptyState
        icon={<BarChart3 />}
        title="Your patterns start with a coffee"
        description="Add a bag and rate a few cups. Analytics will turn that history into trends, comparisons, and discoveries."
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

  const rangeLabel = RANGE_OPTIONS.find((option) => option.value === range)?.label ?? 'All time';
  const change = data.averageScoreChange;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-meta text-primary">Your coffee, decoded</p>
          <h2 className="mt-1 text-3xl font-semibold">Analytics</h2>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Explore what you drink, what scores highest, and how your taste changes.
          </p>
        </div>
        <label className="w-full sm:w-48">
          <span className="text-meta text-muted-foreground mb-1 block">Date range</span>
          <Select
            value={range}
            onChange={(event) => setRange(event.target.value as AnalyticsRange)}
          >
            {RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
      </header>

      <SampleDataNotice />

      {data.totalRatings === 0 ? (
        <Card>
          <EmptyState
            icon={<Star />}
            title={`No ratings in ${rangeLabel.toLowerCase()}`}
            description="Rate a coffee to unlock score trends, brew comparisons, and personalized observations."
            action={
              <Button asChild variant="outline">
                <Link to="/beans">Choose a coffee to rate</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <section aria-label="Overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard
              icon={<Star />}
              label="Average score"
              value={data.averageScore.toFixed(1)}
              detail={
                change === null ? (
                  'Out of 10'
                ) : (
                  <span
                    className={
                      change >= 0
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : 'text-amber-700 dark:text-amber-300'
                    }
                  >
                    {change >= 0 ? (
                      <TrendingUp className="mr-1 inline size-3" aria-hidden="true" />
                    ) : (
                      <TrendingDown className="mr-1 inline size-3" aria-hidden="true" />
                    )}
                    {Math.abs(change).toFixed(1)} vs prior period
                  </span>
                )
              }
            />
            <MetricCard
              icon={<CalendarDays />}
              label="Ratings"
              value={String(data.totalRatings)}
              detail={rangeLabel}
            />
            <MetricCard
              icon={<Bean />}
              label="Coffees rated"
              value={String(data.ratedBeans)}
              detail={`${data.totalBeans} in your library`}
            />
            <MetricCard
              icon={<Compass />}
              label="Brew methods"
              value={String(data.brewMethods.length)}
              detail={
                data.brewMethods[0] ? `Top: ${label(data.brewMethods[0].value)}` : 'No brew data'
              }
            />
          </section>

          {data.insights.length > 0 && (
            <section aria-labelledby="analytics-insights">
              <div className="mb-3 flex items-center gap-2">
                <Lightbulb className="text-primary size-5" aria-hidden="true" />
                <h3 id="analytics-insights" className="text-xl font-semibold">
                  Worth noticing
                </h3>
              </div>
              <ul className="grid gap-3 md:grid-cols-2">
                {data.insights.map((insight) => (
                  <li
                    key={insight}
                    className="from-accent/80 to-card rounded-lg border bg-linear-to-br p-4 text-sm leading-relaxed shadow-sm"
                  >
                    {insight}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Rhythm and ratings</CardTitle>
                <CardDescription>{data.activityWindowLabel}</CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className="h-72 min-w-0"
                  role="img"
                  aria-label={`${data.activityWindowLabel}. ${data.totalRatings} ratings with an average score of ${data.averageScore.toFixed(1)}.`}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data.activity} accessibilityLayer>
                      <CartesianGrid
                        stroke="hsl(var(--border))"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                      />
                      <YAxis
                        yAxisId="count"
                        allowDecimals={false}
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                        width={28}
                      />
                      <YAxis yAxisId="score" domain={[0, 10]} hide orientation="right" />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Bar
                        yAxisId="count"
                        dataKey="count"
                        name="Ratings"
                        fill="hsl(var(--accent-foreground))"
                        fillOpacity={0.28}
                        radius={[5, 5, 0, 0]}
                      />
                      <Line
                        yAxisId="score"
                        dataKey="averageScore"
                        name="Average score"
                        stroke="hsl(var(--primary))"
                        strokeWidth={3}
                        dot={{ r: 3, fill: 'hsl(var(--primary))' }}
                        connectNulls
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Score distribution</CardTitle>
                <CardDescription>How often each whole-score band appears</CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className="h-72 min-w-0"
                  role="img"
                  aria-label={`Score distribution for ${data.totalRatings} ratings. Average ${data.averageScore.toFixed(1)} out of 10.`}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.scoreHistogram} accessibilityLayer>
                      <CartesianGrid
                        stroke="hsl(var(--border))"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="score"
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                        width={28}
                      />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Bar
                        dataKey="count"
                        name="Ratings"
                        fill="hsl(var(--primary))"
                        radius={[5, 5, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </section>

          <section
            aria-label="Preference breakdowns"
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            <RankedBreakdown
              title="Brew methods"
              description="Which way of making coffee earns your best scores."
              items={data.brewMethods}
              baseline={data.baseline}
            />
            <RankedBreakdown
              title="Origins"
              description="Countries associated with your highest-rated coffees."
              items={data.topOrigins}
              baseline={data.baseline}
            />
            <RankedBreakdown
              title="Roast levels"
              description="Which parts of the roast spectrum work best for you."
              items={data.roastLevels}
              baseline={data.baseline}
            />
            <RankedBreakdown
              title="Roasters"
              description="Averages use ratings, not the number of bags."
              items={data.topRoasters}
              baseline={data.baseline}
            />
            <RankedBreakdown
              title="Flavor notes"
              description="Notes on coffees that earned your strongest ratings."
              items={data.topFlavors}
              baseline={data.baseline}
            />
          </section>
        </>
      )}
    </div>
  );
}
