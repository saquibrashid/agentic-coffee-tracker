/**
 * "For you" — taste profile + grounded suggestions (specs/ui.md, issue #13).
 *
 * Suggestions are never generated automatically: the user asks for them, so the
 * (billable, network-dependent) model call is always an explicit choice.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BarChart3,
  Coffee,
  Compass,
  Flame,
  Globe2,
  Lightbulb,
  ShieldCheck,
  Sparkles,
  Sprout,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { db } from '@/services/db';
import { ApiError, type Recommendation } from '@/services/ai';
import {
  MIN_RATINGS_FOR_RECOMMENDATIONS,
  hasEnoughHistory,
  refreshPreferences,
} from '@/services/preferences/compute';
import { buildTasteInsights, getProfileStrength } from '@/services/preferences/insights';
import {
  generateRecommendations,
  getCachedRecommendations,
  type CachedRecommendations,
} from '@/services/preferences/recommendations';
import type { RankedItem, UserPreferences } from '@/types';

function display(value: string): string {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function PreferencePanel({
  title,
  icon,
  items,
}: {
  title: string;
  icon: ReactNode;
  items: RankedItem<string>[];
}) {
  const maxWeight = Math.max(...items.map((item) => item.weightedScore), 1);

  return (
    <div className="bg-muted/45 rounded-lg border p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="bg-accent text-accent-foreground flex size-8 items-center justify-center rounded-full [&_svg]:size-4">
          {icon}
        </span>
        <h4 className="text-sm font-semibold">{title}</h4>
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-xs">Not enough labeled history yet.</p>
      ) : (
        <ol className="space-y-3">
          {items.slice(0, 3).map((item) => (
            <li key={item.value}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">{display(item.value)}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {item.averageScore.toFixed(1)} · {item.count}
                </span>
              </div>
              <div className="bg-background h-1.5 overflow-hidden rounded-full">
                <div
                  className="bg-primary h-full rounded-full"
                  style={{
                    width: `${Math.max(12, (item.weightedScore / maxWeight) * 100)}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function RecommendationArtwork({
  recommendation,
  index,
}: {
  recommendation: Recommendation;
  index: number;
}) {
  const accent = [
    'from-amber-100 via-orange-50 to-stone-200 dark:from-amber-950 dark:via-orange-950 dark:to-stone-900',
    'from-emerald-100 via-lime-50 to-amber-100 dark:from-emerald-950 dark:via-lime-950 dark:to-amber-950',
    'from-rose-100 via-pink-50 to-orange-100 dark:from-rose-950 dark:via-pink-950 dark:to-orange-950',
  ][index % 3];

  return (
    <div
      className={`relative flex min-h-40 items-center justify-center overflow-hidden bg-linear-to-br ${accent}`}
      aria-hidden="true"
    >
      <div className="border-primary/15 absolute -top-12 -right-8 size-40 rounded-full border-[24px]" />
      <div className="border-primary/10 absolute -bottom-16 -left-8 size-44 rounded-full border-[28px]" />
      <Coffee className="text-primary relative size-16 opacity-80" />
      {recommendation.origin && (
        <span className="bg-card/85 text-card-foreground absolute right-3 bottom-3 rounded-full px-3 py-1 text-xs font-medium shadow-sm backdrop-blur">
          {recommendation.origin}
        </span>
      )}
    </div>
  );
}

const RECOMMENDATION_KIND = ['Closest match', 'Fresh direction', 'Wildcard'];

function RecommendationCard({
  recommendation,
  index,
}: {
  recommendation: Recommendation;
  index: number;
}) {
  const attributes = [
    recommendation.roastLevel,
    recommendation.process,
    ...recommendation.flavorNotes,
  ].filter((value): value is string => Boolean(value));

  return (
    <li>
      <Card className="h-full overflow-hidden">
        <RecommendationArtwork recommendation={recommendation} index={index} />
        <CardHeader>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <Badge variant={index === 0 ? 'default' : 'secondary'}>
              {RECOMMENDATION_KIND[index] ?? 'Worth exploring'}
            </Badge>
            <span className="text-meta text-muted-foreground">Pick {index + 1}</span>
          </div>
          <CardTitle>{recommendation.title}</CardTitle>
          <CardDescription>{recommendation.rationale}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {attributes.length > 0 && (
            <div>
              <p className="text-meta text-muted-foreground mb-1.5">What to look for</p>
              <div className="flex flex-wrap gap-1.5">
                {attributes.map((attribute) => (
                  <Badge key={attribute} variant="outline">
                    {display(attribute)}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {recommendation.basedOn.length > 0 && (
            <div>
              <p className="text-meta text-muted-foreground mb-1.5">Why it fits</p>
              <p className="text-sm">{recommendation.basedOn.join(' · ')}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

export function RecommendationsPage() {
  const ratingCount = useLiveQuery(() => db.ratings.count(), []);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [cached, setCached] = useState<CachedRecommendations | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [prefs, existing] = await Promise.all([
        refreshPreferences(),
        getCachedRecommendations(),
      ]);
      if (!active) return;
      setPreferences(prefs);
      setCached(existing ?? null);
    })();
    return () => {
      active = false;
    };
  }, [ratingCount]);

  async function onGenerate() {
    setLoading(true);
    setError(null);
    try {
      setCached(await generateRecommendations());
    } catch (err) {
      setError(
        err instanceof ApiError
          ? 'We could not reach the suggestion service. Try again when you are back online.'
          : 'Something went wrong generating suggestions.',
      );
    } finally {
      setLoading(false);
    }
  }

  if (preferences === null || ratingCount === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-52" />
        <Skeleton className="h-52" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      </div>
    );
  }

  const ready = hasEnoughHistory(preferences);
  const stale = cached !== null && preferences.totalRatings > cached.basedOnRatings;
  const strength = getProfileStrength(preferences.totalRatings);
  const insights = buildTasteInsights(preferences);
  const progress = Math.min(
    100,
    Math.round((preferences.totalRatings / MIN_RATINGS_FOR_RECOMMENDATIONS) * 100),
  );

  return (
    <div className="space-y-6">
      <header>
        <p className="text-meta text-primary">Personalized from your ratings</p>
        <h2 className="mt-1 text-3xl font-semibold">For you</h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          A living portrait of your palate, plus ideas chosen to match it or stretch it.
        </p>
      </header>

      <Card className="overflow-hidden">
        <div className="from-primary/12 via-accent/60 to-card grid gap-6 bg-linear-to-br p-5 sm:p-7 lg:grid-cols-[auto_1fr] lg:items-center">
          <div
            className="relative mx-auto flex size-40 items-center justify-center rounded-full p-3"
            style={{
              background: `conic-gradient(hsl(var(--primary)) ${strength.percent}%, hsl(var(--muted)) 0)`,
            }}
            role="img"
            aria-label={`Taste profile strength: ${strength.label}, ${strength.percent} percent`}
          >
            <div className="bg-card flex size-full flex-col items-center justify-center rounded-full border text-center shadow-sm">
              <Sparkles className="text-primary mb-1 size-5" aria-hidden="true" />
              <strong className="font-display text-xl">{strength.label}</strong>
              <span className="text-muted-foreground text-xs">
                {preferences.totalRatings} ratings
              </span>
            </div>
          </div>
          <div>
            <p className="text-meta text-primary">Profile confidence</p>
            <h3 className="mt-1 text-2xl font-semibold">Your taste is taking shape</h3>
            <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
              {strength.description}
            </p>
            {strength.nextMilestone !== null && (
              <p className="mt-3 text-sm font-medium">
                {strength.nextMilestone - preferences.totalRatings} more{' '}
                {strength.nextMilestone - preferences.totalRatings === 1 ? 'rating' : 'ratings'} to
                reach the next confidence level.
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge variant="secondary">{preferences.totalBeans} coffees logged</Badge>
              {preferences.averageScore > 0 && (
                <Badge variant="secondary">
                  {preferences.averageScore.toFixed(1)} average score
                </Badge>
              )}
              <Badge variant="outline">
                <ShieldCheck aria-hidden="true" /> Computed on this device
              </Badge>
            </div>
          </div>
        </div>
      </Card>

      {!ready ? (
        <Card>
          <CardHeader>
            <CardTitle>Teach the app your taste</CardTitle>
            <CardDescription>
              Ratings are the evidence behind every preference and recommendation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span>{preferences.totalRatings} ratings recorded</span>
                <span>{MIN_RATINGS_FOR_RECOMMENDATIONS} needed</span>
              </div>
              <div className="bg-muted h-3 overflow-hidden rounded-full">
                <div className="bg-primary h-full rounded-full" style={{ width: `${progress}%` }} />
              </div>
            </div>
            <Button asChild>
              <Link to="/beans">Choose a coffee to rate</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <section aria-labelledby="taste-map">
            <div className="mb-3 flex items-center gap-2">
              <BarChart3 className="text-primary size-5" aria-hidden="true" />
              <div>
                <h3 id="taste-map" className="text-xl font-semibold">
                  Your taste map
                </h3>
                <p className="text-muted-foreground text-xs">
                  Bar length balances score with repeat evidence; numbers show average and ratings.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <PreferencePanel
                title="Origins"
                icon={<Globe2 aria-hidden="true" />}
                items={preferences.favoriteOrigins}
              />
              <PreferencePanel
                title="Roasters"
                icon={<Coffee aria-hidden="true" />}
                items={preferences.favoriteRoasters}
              />
              <PreferencePanel
                title="Flavor notes"
                icon={<Sparkles aria-hidden="true" />}
                items={preferences.favoriteFlavors}
              />
              <PreferencePanel
                title="Roast levels"
                icon={<Flame aria-hidden="true" />}
                items={preferences.favoriteRoastLevels}
              />
              <PreferencePanel
                title="Brew methods"
                icon={<Compass aria-hidden="true" />}
                items={preferences.favoriteBrewTypes}
              />
              <PreferencePanel
                title="Processes"
                icon={<Sprout aria-hidden="true" />}
                items={preferences.favoriteProcesses}
              />
            </div>
          </section>

          {insights.length > 0 && (
            <section aria-labelledby="taste-insights">
              <div className="mb-3 flex items-center gap-2">
                <Lightbulb className="text-primary size-5" aria-hidden="true" />
                <h3 id="taste-insights" className="text-xl font-semibold">
                  What your history suggests
                </h3>
              </div>
              <ul className="grid gap-3 md:grid-cols-2">
                {insights.map((insight) => (
                  <li key={insight.title} className="bg-card rounded-lg border p-4 shadow-sm">
                    <h4 className="font-semibold">{insight.title}</h4>
                    <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                      {insight.body}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <section aria-labelledby="next-coffees">
        <Card className="overflow-hidden">
          <CardHeader className="from-accent/75 to-card bg-linear-to-r">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div>
                <CardTitle id="next-coffees">What to try next</CardTitle>
                <CardDescription className="mt-1 max-w-2xl">
                  Ask for a balanced set: one close match, one fresh direction, and one wildcard
                  grounded in your profile.
                </CardDescription>
              </div>
              <Button onClick={() => void onGenerate()} disabled={!ready || loading}>
                <Sparkles aria-hidden="true" />
                {loading ? 'Thinking…' : cached ? 'Refresh ideas' : 'Suggest coffees'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4 sm:pt-5">
            <div className="flex items-start gap-2 text-xs">
              <ShieldCheck className="text-primary mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p className="text-muted-foreground">
                Only an anonymous summary of your taste profile leaves this device. Notes and photos
                stay private, and generation happens only when you choose it.
              </p>
            </div>

            {stale && (
              <p className="bg-accent text-accent-foreground rounded-md px-3 py-2 text-sm">
                You have rated more coffees since these ideas were generated. Refresh for a current
                set.
              </p>
            )}

            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}

            {cached && cached.recommendations.length === 0 && (
              <p className="text-muted-foreground py-6 text-center text-sm">
                There is not enough history yet to suggest anything with confidence.
              </p>
            )}

            {!cached && ready && (
              <div className="py-8 text-center">
                <Coffee className="text-primary/70 mx-auto size-10" aria-hidden="true" />
                <p className="mt-3 font-medium">Your next favorite may be one click away.</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  Suggestions are never generated automatically.
                </p>
              </div>
            )}

            {cached && cached.recommendations.length > 0 && (
              <ul className="grid gap-4 lg:grid-cols-3">
                {cached.recommendations.map((recommendation, index) => (
                  <RecommendationCard
                    key={`${recommendation.title}-${index}`}
                    recommendation={recommendation}
                    index={index}
                  />
                ))}
              </ul>
            )}

            {cached && (
              <p className="text-muted-foreground text-xs">
                Generated {new Date(cached.generatedAt).toLocaleString()} · {cached.model}
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
