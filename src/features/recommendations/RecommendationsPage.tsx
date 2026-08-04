/**
 * "For you" — taste profile + grounded suggestions (specs/ui.md, issue #13).
 *
 * Suggestions are never generated automatically: the user asks for them, so the
 * (billable, network-dependent) model call is always an explicit choice.
 */
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/services/db';
import { ApiError } from '@/services/ai';
import {
  MIN_RATINGS_FOR_RECOMMENDATIONS,
  hasEnoughHistory,
  refreshPreferences,
} from '@/services/preferences/compute';
import {
  generateRecommendations,
  getCachedRecommendations,
  type CachedRecommendations,
} from '@/services/preferences/recommendations';
import type { RankedItem, UserPreferences } from '@/types';

function TasteRow({ label, items }: { label: string; items: RankedItem<string>[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="text-sm text-muted-foreground">
        {items.map((i) => `${i.value} (${i.count})`).join(' · ')}
      </dd>
    </div>
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

  const ready = hasEnoughHistory(preferences ?? undefined);
  const stale =
    cached !== null && preferences !== null && preferences.totalRatings > cached.basedOnRatings;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Your taste profile</CardTitle>
          <CardDescription>
            Computed on this device from {preferences?.totalRatings ?? 0} rating
            {preferences?.totalRatings === 1 ? '' : 's'}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!ready ? (
            <p className="text-sm text-muted-foreground">
              Rate at least {MIN_RATINGS_FOR_RECOMMENDATIONS} coffees and your profile will appear
              here.
            </p>
          ) : (
            <dl className="space-y-2">
              <TasteRow label="Origins" items={preferences?.favoriteOrigins ?? []} />
              <TasteRow label="Roasters" items={preferences?.favoriteRoasters ?? []} />
              <TasteRow label="Flavours" items={preferences?.favoriteFlavors ?? []} />
              <TasteRow
                label="Roast levels"
                items={(preferences?.favoriteRoastLevels ?? [])}
              />
              <TasteRow
                label="Brew methods"
                items={(preferences?.favoriteBrewTypes ?? [])}
              />
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What to try next</CardTitle>
          <CardDescription>
            Suggestions are grounded in your ratings. Only an anonymous summary of your taste
            profile leaves this device — never your notes or photos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void onGenerate()} disabled={!ready || loading}>
              <Sparkles aria-hidden="true" />
              {loading ? 'Thinking…' : cached ? 'Refresh suggestions' : 'Suggest coffees'}
            </Button>
            {stale && (
              <p className="text-sm text-muted-foreground">
                You&apos;ve rated more coffees since these were generated.
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          {cached && cached.recommendations.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Not enough history yet to suggest anything with confidence.
            </p>
          )}

          {cached && cached.recommendations.length > 0 && (
            <ul className="space-y-3">
              {cached.recommendations.map((rec) => (
                <li key={rec.title} className="rounded-md border p-3">
                  <h3 className="font-medium">{rec.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{rec.rationale}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Based on: {rec.basedOn.join(', ')}
                  </p>
                  {rec.flavorNotes.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Look for: {rec.flavorNotes.join(', ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {cached && (
            <p className="text-xs text-muted-foreground">
              Generated {new Date(cached.generatedAt).toLocaleString()} · {cached.model}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
