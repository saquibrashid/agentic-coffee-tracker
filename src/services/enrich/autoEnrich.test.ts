import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  beanNeedsEnrichment,
  fillMissingFields,
  isFieldMissing,
  isTerminalEnrichFailure,
  missingFields,
  NoCandidatesError,
  autoEnrichBean,
} from './autoEnrich';
import { EmptyPageError } from './index';
import type * as EnrichModule from './index';
import { ApiError } from '@/services/ai';
import type { CoffeeBean } from '@/types';

vi.mock('./index', async () => {
  const actual = await vi.importActual<typeof EnrichModule>('./index');
  return {
    ...actual,
    findCandidates: vi.fn(),
    enrichFromUrl: vi.fn(),
  };
});

vi.mock('./photo', () => ({
  attachPhotoFromUrl: vi.fn(),
  beanNeedsPhoto: (b: CoffeeBean) => !b.photoId,
}));

const enrichModule = await import('./index');
const findCandidates = vi.mocked(enrichModule.findCandidates);
const enrichFromUrl = vi.mocked(enrichModule.enrichFromUrl);
const { attachPhotoFromUrl } = vi.mocked(await import('./photo'));

function bean(overrides: Partial<CoffeeBean> = {}): CoffeeBean {
  return {
    id: 'b1',
    schemaVersion: 1,
    roaster: 'Onyx Coffee Lab',
    name: 'Southern Weather',
    source: 'manual',
    isArchived: false,
    needsReview: false,
    createdAt: '2025-03-14T12:00:00.000Z',
    updatedAt: '2025-03-14T12:00:00.000Z',
    ...overrides,
  };
}

function parsed(overrides: Record<string, unknown> = {}) {
  return {
    roaster: 'Onyx Coffee Lab',
    name: 'Southern Weather',
    origins: [{ country: 'Colombia', region: null, farm: null, producer: null, percentage: null }],
    process: 'washed' as const,
    roastLevel: 'medium-light' as const,
    tastingNotes: ['chocolate', 'citrus'],
    roastDate: '2025-06-01',
    varietals: ['Caturra'],
    elevationMeters: { min: 1700, max: 1900 },
    roasterDescription: 'A blend built for milk.',
    confidence: 0.9,
    ...overrides,
  };
}

beforeEach(() => {
  findCandidates.mockReset();
  enrichFromUrl.mockReset();
  attachPhotoFromUrl.mockReset();
  attachPhotoFromUrl.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isFieldMissing', () => {
  it('treats absent, empty and "unknown" as missing', () => {
    expect(isFieldMissing(bean(), 'process')).toBe(true);
    expect(isFieldMissing(bean({ process: 'unknown' }), 'process')).toBe(true);
    expect(isFieldMissing(bean({ roastLevel: 'unknown' }), 'roastLevel')).toBe(true);
    expect(isFieldMissing(bean({ tastingNotes: [] }), 'tastingNotes')).toBe(true);
    expect(isFieldMissing(bean({ roasterDescription: '  ' }), 'roasterDescription')).toBe(true);
    expect(isFieldMissing(bean({ elevationMeters: {} }), 'elevationMeters')).toBe(true);
  });

  it('treats a real value as present', () => {
    expect(isFieldMissing(bean({ process: 'natural' }), 'process')).toBe(false);
    expect(isFieldMissing(bean({ tastingNotes: ['cocoa'] }), 'tastingNotes')).toBe(false);
    expect(isFieldMissing(bean({ elevationMeters: { min: 1700 } }), 'elevationMeters')).toBe(false);
  });
});

describe('missingFields / beanNeedsEnrichment', () => {
  it('reports a bare imported row as needing everything', () => {
    expect(missingFields(bean())).toEqual([
      'origins',
      'process',
      'roastLevel',
      'varietals',
      'elevationMeters',
      'tastingNotes',
      'roasterDescription',
    ]);
    expect(beanNeedsEnrichment(bean())).toBe(true);
  });

  it('reports a fully described coffee as complete', () => {
    const full = bean({
      photoId: 'p1',
      origins: [{ country: 'Colombia' }],
      process: 'washed',
      roastLevel: 'medium',
      varietals: ['Caturra'],
      elevationMeters: { min: 1700 },
      tastingNotes: ['cocoa'],
      roasterDescription: 'Lovely.',
    });
    expect(missingFields(full)).toEqual([]);
    expect(beanNeedsEnrichment(full)).toBe(false);
  });

  it('still wants a lookup when only the picture is missing', () => {
    // An imported row never has a photo, and a library card with no image is
    // the most visible gap there is — worth a lookup even with full metadata.
    const noPhoto = bean({
      origins: [{ country: 'Colombia' }],
      process: 'washed',
      roastLevel: 'medium',
      varietals: ['Caturra'],
      elevationMeters: { min: 1700 },
      tastingNotes: ['cocoa'],
      roasterDescription: 'Lovely.',
    });

    expect(missingFields(noPhoto)).toEqual([]);
    expect(beanNeedsEnrichment(noPhoto)).toBe(true);
  });

  it('does not queue a lookup for gaps no spreadsheet could fill', () => {
    // Varietals, elevation and the roaster blurb have no CSV column, so a row
    // that is otherwise complete must not trigger a lookup on every import.
    const coreComplete = bean({
      photoId: 'p1',
      origins: [{ country: 'Colombia' }],
      process: 'washed',
      roastLevel: 'medium',
      tastingNotes: ['cocoa'],
    });

    expect(beanNeedsEnrichment(coreComplete)).toBe(false);
    expect(missingFields(coreComplete)).toEqual([
      'varietals',
      'elevationMeters',
      'roasterDescription',
    ]);
  });
});

describe('fillMissingFields', () => {
  it('never overwrites a value the user supplied', () => {
    const existing = bean({ process: 'natural', tastingNotes: ['strawberry'] });

    const filled = fillMissingFields(existing, {
      process: 'washed',
      tastingNotes: ['chocolate'],
      roastLevel: 'medium',
    });

    expect(filled).toEqual({ roastLevel: 'medium' });
  });

  it('ignores fields the lookup could not resolve', () => {
    expect(fillMissingFields(bean(), { tastingNotes: [] })).toEqual({});
  });

  it('refuses to touch fields outside the enrichable set', () => {
    const filled = fillMissingFields(bean(), {
      roaster: 'Wrong Roaster',
      name: 'Wrong Coffee',
      roastDate: '2025-06-01',
      confidence: 0.2,
      process: 'honey',
    });

    expect(filled).toEqual({ process: 'honey' });
  });
});

describe('isTerminalEnrichFailure', () => {
  it('is terminal for a failed lookup or an unreadable page', () => {
    expect(isTerminalEnrichFailure(new NoCandidatesError('Onyx', 'Geometry'))).toBe(true);
    expect(isTerminalEnrichFailure(new EmptyPageError('https://example.com'))).toBe(true);
    expect(isTerminalEnrichFailure(new ApiError('bad', 400))).toBe(true);
  });

  it('is retryable when the backend is down or throttling', () => {
    expect(isTerminalEnrichFailure(new ApiError('boom', 503))).toBe(false);
    expect(isTerminalEnrichFailure(new ApiError('slow down', 429))).toBe(false);
    expect(isTerminalEnrichFailure(new TypeError('Failed to fetch'))).toBe(false);
  });
});

describe('autoEnrichBean', () => {
  it('does nothing when the coffee is already complete', async () => {
    const full = bean({
      photoId: 'p1',
      origins: [{ country: 'Colombia' }],
      process: 'washed',
      roastLevel: 'medium',
      tastingNotes: ['cocoa'],
    });

    await expect(autoEnrichBean(full)).resolves.toBeNull();
    expect(findCandidates).not.toHaveBeenCalled();
  });

  it('fills the gaps from the top search result', async () => {
    findCandidates.mockResolvedValue([
      { url: 'https://onyx.example/sw', title: 'Southern Weather', snippet: '' },
    ]);
    enrichFromUrl.mockResolvedValue({
      parsed: parsed(),
      rawText: 'raw',
      sourceUrl: 'https://onyx.example/sw',
      model: 'gpt-4o',
    });

    const result = await autoEnrichBean(bean({ process: 'natural' }));

    expect(result?.update.process).toBeUndefined();
    expect(result?.update.roastLevel).toBe('medium-light');
    expect(result?.update.tastingNotes).toEqual(['chocolate', 'citrus']);
    expect(result?.update.sourceUrl).toBe('https://onyx.example/sw');
    // A product page advertises the current batch, not the bag that was drunk.
    expect(result?.update.roastDate).toBeUndefined();
    expect(result?.filled).toContain('roastLevel');
  });

  it('throws a terminal error when nothing was found', async () => {
    findCandidates.mockResolvedValue([]);

    await expect(autoEnrichBean(bean())).rejects.toBeInstanceOf(NoCandidatesError);
    expect(enrichFromUrl).not.toHaveBeenCalled();
  });

  it('returns null when the page added nothing new', async () => {
    findCandidates.mockResolvedValue([
      { url: 'https://onyx.example/sw', title: 'Southern Weather', snippet: '' },
    ]);
    enrichFromUrl.mockResolvedValue({
      parsed: parsed({
        origins: [],
        process: null,
        roastLevel: null,
        tastingNotes: [],
        varietals: [],
        elevationMeters: null,
        roasterDescription: null,
      }),
      rawText: 'raw',
      sourceUrl: 'https://onyx.example/sw',
      model: 'gpt-4o',
    });

    await expect(autoEnrichBean(bean())).resolves.toBeNull();
  });

  it('saves a photo even when the page had no new details', async () => {
    // The whole point of looking a coffee up can be the picture: a row with
    // complete metadata and no image must still come back with something.
    findCandidates.mockResolvedValue([
      { url: 'https://onyx.example/sw', title: 'Southern Weather', snippet: '' },
    ]);
    enrichFromUrl.mockResolvedValue({
      parsed: parsed({
        origins: [],
        process: null,
        roastLevel: null,
        tastingNotes: [],
        varietals: [],
        elevationMeters: null,
        roasterDescription: null,
      }),
      rawText: 'raw',
      sourceUrl: 'https://onyx.example/sw',
      model: 'gpt-4o',
      imageUrl: 'https://onyx.example/bag.jpg',
    });
    attachPhotoFromUrl.mockResolvedValue({ photoId: 'p9', thumbnailDataUrl: 'data:image/jpeg,x' });

    const result = await autoEnrichBean(bean());

    expect(attachPhotoFromUrl).toHaveBeenCalledWith('https://onyx.example/bag.jpg');
    expect(result?.photoAttached).toBe(true);
    expect(result?.filled).toEqual([]);
    expect(result?.update.photoId).toBe('p9');
    expect(result?.update.thumbnailDataUrl).toBe('data:image/jpeg,x');
  });

  it('leaves a photo the user already took alone', async () => {
    findCandidates.mockResolvedValue([
      { url: 'https://onyx.example/sw', title: 'Southern Weather', snippet: '' },
    ]);
    enrichFromUrl.mockResolvedValue({
      parsed: parsed(),
      rawText: 'raw',
      sourceUrl: 'https://onyx.example/sw',
      model: 'gpt-4o',
      imageUrl: 'https://onyx.example/bag.jpg',
    });

    const result = await autoEnrichBean(bean({ photoId: 'mine' }));

    expect(attachPhotoFromUrl).not.toHaveBeenCalled();
    expect(result?.photoAttached).toBe(false);
    expect(result?.update.photoId).toBeUndefined();
  });

  it('still fills the details when the image could not be downloaded', async () => {
    findCandidates.mockResolvedValue([
      { url: 'https://onyx.example/sw', title: 'Southern Weather', snippet: '' },
    ]);
    enrichFromUrl.mockResolvedValue({
      parsed: parsed(),
      rawText: 'raw',
      sourceUrl: 'https://onyx.example/sw',
      model: 'gpt-4o',
      imageUrl: 'https://onyx.example/dead.jpg',
    });
    attachPhotoFromUrl.mockResolvedValue(null);

    const result = await autoEnrichBean(bean());

    expect(result?.photoAttached).toBe(false);
    expect(result?.update.roastLevel).toBe('medium-light');
    expect(result?.update.photoId).toBeUndefined();
  });
});
