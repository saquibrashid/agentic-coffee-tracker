/**
 * Turns locally computed preferences into suggestions via `/api/recommend`.
 *
 * Only an anonymous summary is sent — no bean names, notes, photos, or dates.
 * Results are cached in `meta` so the page opens instantly and the user controls
 * when a new (billable) model call happens.
 */
import { db } from '@/services/db';
import { recommend, type PreferenceSummary, type Recommendation } from '@/services/ai';
import { refreshPreferences } from './compute';
import type { RankedItem, UserPreferences } from '@/types';

const CACHE_KEY = 'recommendations-v1';

export interface CachedRecommendations {
  recommendations: Recommendation[];
  model: string;
  generatedAt: string;
  /** Ratings count at generation time, used to tell the user when it is stale. */
  basedOnRatings: number;
}

function summarize<T extends string>(items: RankedItem<T>[]): PreferenceSummary['favoriteOrigins'] {
  return items.map((item) => ({
    value: item.value,
    count: item.count,
    averageScore: Number(item.averageScore.toFixed(2)),
  }));
}

/** Strips everything the model does not need. This is the privacy boundary. */
export function toPreferenceSummary(preferences: UserPreferences): PreferenceSummary {
  return {
    favoriteOrigins: summarize(preferences.favoriteOrigins),
    favoriteRoasters: summarize(preferences.favoriteRoasters),
    favoriteProcesses: summarize(preferences.favoriteProcesses),
    favoriteRoastLevels: summarize(preferences.favoriteRoastLevels),
    favoriteFlavors: summarize(preferences.favoriteFlavors),
    favoriteBrewTypes: summarize(preferences.favoriteBrewTypes),
    averageScore: Number(preferences.averageScore.toFixed(2)),
    totalRatings: preferences.totalRatings,
  };
}

export async function getCachedRecommendations(): Promise<CachedRecommendations | undefined> {
  const record = await db.meta.get(CACHE_KEY);
  return record?.value as CachedRecommendations | undefined;
}

/** Recomputes preferences, calls the BFF, and caches the result. */
export async function generateRecommendations(max = 3): Promise<CachedRecommendations> {
  const preferences = await refreshPreferences();
  const response = await recommend({ preferences: toPreferenceSummary(preferences), max });

  const cached: CachedRecommendations = {
    recommendations: response.recommendations,
    model: response.model,
    generatedAt: new Date().toISOString(),
    basedOnRatings: preferences.totalRatings,
  };
  await db.meta.put({ key: CACHE_KEY, value: cached });
  return cached;
}
